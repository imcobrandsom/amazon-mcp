/**
 * POST /api/bol-sync-keywords
 * Cron: elke maandag 07:00 (zie vercel.json)
 *
 * Run 1..N: backfill 100 keywords per run met 26 weken data
 * Run N+1+: weekly update — vorige week ophalen voor alle backfilled keywords
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';
import { getBolToken, getSearchTerms, sleep } from './_lib/bol-api-client.js.js';

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

/** Geeft de meest recente maandag als Date (UTC midnight) */
function getMostRecentMonday(): Date {
  const d = new Date();
  const day = d.getUTCDay(); // 0=zo, 1=ma, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Berekent de week_of datum voor periodeindex i (0 = huidige week, 1 = vorige, etc.) */
function periodIndexToDateStr(mostRecentMonday: Date, index: number): string {
  const d = new Date(mostRecentMonday);
  d.setUTCDate(d.getUTCDate() - index * 7);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
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

const MAX_KEYWORDS_PER_RUN = 100; // Pas aan op basis van Vercel timeout

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
  if (!isAuthorised(req)) return res.status(401).json({ error: 'Unauthorised' });

  const supabase  = createAdminClient();
  const startedAt = Date.now();
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

      const mostRecentMonday = getMostRecentMonday();

      // ── Stap A: Bouw / update keyword master list ─────────────────────────

      // Bron 1: trending_keywords per categorie uit competitor research
      const { data: insights } = await supabase
        .from('bol_category_insights')
        .select('category_slug, trending_keywords')
        .eq('bol_customer_id', customerId)
        .order('generated_at', { ascending: false });

      // Bron 2: advertising keywords (kolom heet keyword_text)
      const { data: adKeywords } = await supabase
        .from('bol_keyword_performance')
        .select('keyword_text, campaign_id')
        .eq('bol_customer_id', customerId);

      const { data: productCats } = await supabase
        .from('bol_product_categories')
        .select('ean, category_slug')
        .eq('bol_customer_id', customerId);

      const allCategorySlugs = [...new Set((productCats ?? []).map(r => r.category_slug as string))];

      // Map: category_slug → Set<keyword>
      const keywordsByCategory = new Map<string, Set<string>>();
      for (const slug of allCategorySlugs) {
        keywordsByCategory.set(slug, new Set());
      }

      // Voeg competitor research keywords toe per categorie
      for (const insight of insights ?? []) {
        const slug = insight.category_slug as string;
        const trendingKws = (insight.trending_keywords as Array<{ keyword: string }> | null) ?? [];
        if (!keywordsByCategory.has(slug)) keywordsByCategory.set(slug, new Set());
        for (const { keyword } of trendingKws) {
          if (keyword?.trim() && !isBrandTerm(keyword)) {
            keywordsByCategory.get(slug)!.add(keyword.trim().toLowerCase());
          }
        }
      }

      // Voeg advertising keywords toe aan alle categorieën
      const adKws = [...new Set(
        (adKeywords ?? [])
          .map(r => (r.keyword_text as string | null)?.trim().toLowerCase())
          .filter((k): k is string => !!k && !isBrandTerm(k))
      )];
      for (const slug of allCategorySlugs) {
        for (const kw of adKws) keywordsByCategory.get(slug)!.add(kw);
      }

      // Upsert keyword master list
      let masterUpserted = 0;
      for (const [categorySlug, keywords] of keywordsByCategory.entries()) {
        const rows = Array.from(keywords).map(keyword => ({
          bol_customer_id: customerId,
          category_slug:   categorySlug,
          keyword,
          source:          'competitor_research' as const,
          is_brand_term:   false,
        }));
        if (rows.length > 0) {
          await supabase.from('bol_keyword_master').upsert(rows, {
            onConflict: 'bol_customer_id,category_slug,keyword',
            ignoreDuplicates: true,
          });
          masterUpserted += rows.length;
        }
      }
      detail.master_keywords = masterUpserted;

      // ── Stap B: Bepaal run-modus (backfill vs. weekly update) ─────────────

      // Haal alle keywords op die nog niet gebackfilld zijn
      const { data: pendingBackfill } = await supabase
        .from('bol_keyword_master')
        .select('id, keyword, category_slug')
        .eq('bol_customer_id', customerId)
        .eq('is_brand_term', false)
        .eq('backfill_complete', false)
        .limit(MAX_KEYWORDS_PER_RUN);

      const isBackfillMode = (pendingBackfill?.length ?? 0) > 0;

      if (isBackfillMode) {
        // ── BACKFILL: 26 weken per keyword, max 100 keywords per run ────────
        detail.mode = 'backfill';
        let backfilled = 0;
        let volumeRows = 0;

        let apiCallsMade = 0;
        let keywordsWithData = 0;
        let keywordsWithoutData = 0;

        for (const kwEntry of pendingBackfill ?? []) {
          const keyword      = kwEntry.keyword as string;
          const categorySlug = kwEntry.category_slug as string;
          const masterId     = kwEntry.id as string;

          try {
            // Eén API call geeft 26 weken terug
            const { searchTerm: st } = await getSearchTerms(token, keyword, 'WEEK', 26);
            apiCallsMade++;

            if (st && st.periods && st.periods.length > 0) {
              const periods = st.periods;

              // Maak één rij per week (index 0 = huidige/lopende week, sla die over)
              // Gebruik index 1..25 = afgelopen 25 complete weken + index 0 als huidige
              const rows: Array<{
                bol_customer_id: string;
                category_slug: string;
                keyword: string;
                search_volume: number;
                week_of: string;
              }> = [];

              for (let i = 0; i < periods.length; i++) {
                const weekOf = periodIndexToDateStr(mostRecentMonday, i);
                const count  = periods[i]?.total ?? 0;
                if (count > 0) {
                  rows.push({
                    bol_customer_id: customerId,
                    category_slug:   categorySlug,
                    keyword:         st.searchTerm.trim().toLowerCase(),
                    search_volume:   count,
                    week_of:         weekOf,
                  });
                }
              }

              if (rows.length > 0) {
                const { error: insErr } = await supabase
                  .from('bol_keyword_search_volume')
                  .upsert(rows, {
                    onConflict: 'bol_customer_id,keyword,week_of',
                    ignoreDuplicates: true,
                  });
                if (insErr) {
                  console.error(`[bol-sync-keywords] insert error for "${keyword}":`, insErr.message);
                } else {
                  volumeRows += rows.length;
                  keywordsWithData++;
                }
              } else {
                keywordsWithoutData++;
              }
            } else {
              keywordsWithoutData++;
            }

            // Markeer keyword als gebackfilld
            await supabase
              .from('bol_keyword_master')
              .update({ backfill_complete: true, last_backfill_at: new Date().toISOString() })
              .eq('id', masterId);

            backfilled++;
          } catch (err) {
            console.error(`[bol-sync-keywords] backfill error for "${keyword}":`, (err as Error).message);
          }

          await sleep(150); // ~6-7 keywords/sec
        }

        detail.backfilled_keywords = backfilled;
        detail.volume_rows_inserted = volumeRows;
        detail.api_calls_made = apiCallsMade;
        detail.keywords_with_data = keywordsWithData;
        detail.keywords_without_data = keywordsWithoutData;
        detail.remaining_to_backfill = 'check next run';

      } else {
        // ── WEEKLY UPDATE: vorige complete week ophalen voor alle keywords ──
        detail.mode = 'weekly';

        // Haal alle backfilled keywords op
        const { data: allKeywords } = await supabase
          .from('bol_keyword_master')
          .select('keyword, category_slug')
          .eq('bol_customer_id', customerId)
          .eq('is_brand_term', false)
          .eq('backfill_complete', true);

        const prevMondayStr = periodIndexToDateStr(mostRecentMonday, 1); // vorige week
        let weeklyRows = 0;
        let weeklyErrors = 0;

        for (const kwEntry of allKeywords ?? []) {
          const keyword      = kwEntry.keyword as string;
          const categorySlug = kwEntry.category_slug as string;

          try {
            // number-of-periods=2: [0]=huidige (incomplete), [1]=vorige (complete)
            const { searchTerm: st } = await getSearchTerms(token, keyword, 'WEEK', 2);

            if (st && st.periods && st.periods.length > 1) {
              const periods    = st.periods;
              const prevCount  = periods[1]?.total ?? 0;

              if (prevCount > 0) {
                const { error: insErr } = await supabase
                  .from('bol_keyword_search_volume')
                  .upsert({
                    bol_customer_id: customerId,
                    category_slug:   categorySlug,
                    keyword:         st.searchTerm.trim().toLowerCase(),
                    search_volume:   prevCount,
                    week_of:         prevMondayStr,
                  }, {
                    onConflict: 'bol_customer_id,keyword,week_of',
                    ignoreDuplicates: false, // update als al bestaat
                  });

                if (insErr) {
                  console.error(`[bol-sync-keywords] weekly error for "${keyword}":`, insErr.message);
                  weeklyErrors++;
                } else {
                  weeklyRows++;
                }
              }
            }
          } catch (err) {
            console.error(`[bol-sync-keywords] weekly fetch error for "${keyword}":`, (err as Error).message);
            weeklyErrors++;
          }

          await sleep(150);
        }

        detail.weekly_week = prevMondayStr;
        detail.weekly_rows_upserted = weeklyRows;
        detail.weekly_errors = weeklyErrors;
      }

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
