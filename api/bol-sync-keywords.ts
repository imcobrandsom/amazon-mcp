/**
 * POST /api/bol-sync-keywords
 * Cron: elke maandag 07:00 (zie vercel.json)
 *
 * Per customer:
 *  1. Bouw keyword master lijst op (uit competitor research + advertising)
 *  2. Filter merknamen eruit
 *  3. Backfill: voor de eerste categorie die nog niet klaar is, haal 26 weken op
 *  4. Weekly run: haal data op voor huidige week (voor alle categorieën)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getBolToken, getSearchTerms, sleep } from './_lib/bol-api-client.js';

// Bekende merk-namen die gefilterd moeten worden
// Uitbreidbaar — voeg toe als je meer merken tegenkomt
const BRAND_BLOCKLIST = new Set([
  'nike', 'adidas', 'puma', 'reebok', 'under armour', 'new balance',
  'asics', 'columbia', 'the north face', 'lululemon', 'gymshark',
  'fila', 'hummel', 'champion', 'ellesse', 'björn borg', 'bjorn borg',
  'craft', 'odlo', 'falke', 'h&m', 'zara', 'primark',
]);

function isBrandTerm(keyword: string): boolean {
  const lower = keyword.toLowerCase().trim();
  for (const brand of BRAND_BLOCKLIST) {
    if (lower.includes(brand)) return true;
  }
  return false;
}

function getMondaysBefore(n: number): string[] {
  const mondays: string[] = [];
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff); // meest recente maandag
  for (let i = 0; i < n; i++) {
    mondays.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return mondays; // [nieuwste, ..., oudste]
}

function isAuthorised(req: VercelRequest): boolean {
  const cronSecret    = process.env.CRON_SECRET;
  const webhookSecret = process.env.BOL_WEBHOOK_SECRET;
  const auth          = req.headers['authorization'] ?? '';
  const manual        = req.headers['x-webhook-secret'];
  return (cronSecret && auth === `Bearer ${cronSecret}`)
      || (webhookSecret && manual === webhookSecret)
      || false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
  if (!isAuthorised(req)) return res.status(401).json({ error: 'Unauthorised' });

  const supabase   = createAdminClient();
  const startedAt  = Date.now();
  const results: Record<string, unknown>[] = [];

  const { data: customers } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret')
    .eq('active', true);

  for (const customer of customers ?? []) {
    const customerId = customer.id as string;
    const detail: Record<string, unknown> = {};

    try {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      // ── Stap A: Verzamel keywords uit twee bronnen ────────────────────────

      // Bron 1: trending_keywords uit bol_category_insights (competitor research)
      const { data: insights } = await supabase
        .from('bol_category_insights')
        .select('category_slug, trending_keywords')
        .eq('bol_customer_id', customerId)
        .order('generated_at', { ascending: false });

      // Bron 2: advertising keywords uit bol_keyword_performance
      const { data: adKeywords } = await supabase
        .from('bol_keyword_performance')
        .select('keyword, campaign_id')
        .eq('bol_customer_id', customerId);

      // Koppel advertising keywords aan categorie via bol_product_categories + campaigns
      // (Eenvoudig: voeg alle ad keywords toe aan de categorieën waar de customer producten heeft)
      const { data: productCats } = await supabase
        .from('bol_product_categories')
        .select('ean, category_slug')
        .eq('bol_customer_id', customerId);

      const allCategorySlugs = [...new Set((productCats ?? []).map(r => r.category_slug as string))];

      // Map: category_slug → Set<keyword>
      const keywordsByCategory = new Map<string, Set<string>>();

      // Initialiseer voor alle bekende categorieën
      for (const slug of allCategorySlugs) {
        keywordsByCategory.set(slug, new Set());
      }

      // Voeg competitor research keywords toe per categorie
      for (const insight of insights ?? []) {
        const slug = insight.category_slug as string;
        const trendingKws = (insight.trending_keywords as Array<{ keyword: string }> | null) ?? [];
        if (!keywordsByCategory.has(slug)) keywordsByCategory.set(slug, new Set());
        for (const { keyword } of trendingKws) {
          if (keyword?.trim()) keywordsByCategory.get(slug)!.add(keyword.trim().toLowerCase());
        }
      }

      // Voeg advertising keywords toe aan alle categorieën (ze zijn niet aan één categorie gebonden)
      const adKws = [...new Set((adKeywords ?? []).map(r => (r.keyword as string)?.trim().toLowerCase()).filter(Boolean))];
      for (const slug of allCategorySlugs) {
        for (const kw of adKws) {
          keywordsByCategory.get(slug)!.add(kw);
        }
      }

      // ── Stap B: Upsert keyword master list ───────────────────────────────
      let keywordsUpserted = 0;
      for (const [categorySlug, keywords] of keywordsByCategory.entries()) {
        const rows = Array.from(keywords).map(keyword => ({
          bol_customer_id: customerId,
          category_slug:   categorySlug,
          keyword,
          source:          'competitor_research', // default; advertising ook OK
          is_brand_term:   isBrandTerm(keyword),
        }));
        if (rows.length > 0) {
          await supabase.from('bol_keyword_master').upsert(rows, {
            onConflict: 'bol_customer_id,category_slug,keyword',
            ignoreDuplicates: true,
          });
          keywordsUpserted += rows.length;
        }
      }
      detail.keywords_in_master = keywordsUpserted;

      // ── Stap C: Fetch search volume for all keywords ─────────────────────
      // Use Search Terms API to get volume data for keywords (one at a time)
      const currentWeek = getMondaysBefore(1)[0];
      let totalKeywordsProcessed = 0;

      // Process keywords one by one (API doesn't support batch queries)
      for (const [categorySlug, keywords] of keywordsByCategory.entries()) {
        const rows: Array<{
          bol_customer_id: string;
          ean: null;
          search_type: string;
          keyword: string;
          category_slug: string;
          category_id: null;
          rank: null;
          impressions: number;
          week_of: string;
        }> = [];

        for (const keyword of Array.from(keywords)) {
          try {
            const { searchTerms } = await getSearchTerms(token, keyword, 'MONTH');

            if (searchTerms.length > 0) {
              const st = searchTerms[0]; // Should only return one result
              rows.push({
                bol_customer_id: customerId,
                ean:            null,
                search_type:    'SEARCH',
                keyword:        st.searchTerm.trim().toLowerCase(),
                category_slug:  categorySlug,
                category_id:    null,
                rank:           null,
                impressions:    st.total,
                week_of:        currentWeek,
              });
            }
          } catch (err) {
            // Silent fail for individual keywords (some may not have data)
            console.error(`[bol-sync-keywords] ${categorySlug}/${keyword}:`, (err as Error).message);
          }
          await sleep(100); // Rate limiting (10 requests/sec)
        }

        // Batch insert all keywords for this category
        if (rows.length > 0) {
          const { error: insertError } = await supabase
            .from('bol_keyword_rankings')
            .upsert(rows, { onConflict: 'bol_customer_id,keyword,week_of', ignoreDuplicates: true });

          if (insertError) {
            console.error(`[bol-sync-keywords] insert failed for ${categorySlug}:`, insertError.message);
          } else {
            totalKeywordsProcessed += rows.length;
          }
        }
      }

      detail.search_volume_fetched = totalKeywordsProcessed;

      results.push({ customerId, sellerName: customer.seller_name, status: 'ok', detail });
    } catch (err) {
      results.push({ customerId: customer.id, status: 'error', detail: { error: (err as Error).message } });
    }
  }

  return res.status(200).json({
    processed: (customers ?? []).length,
    duration_ms: Date.now() - startedAt,
    results,
  });
}
