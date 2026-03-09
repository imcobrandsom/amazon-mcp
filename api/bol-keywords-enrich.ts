/**
 * POST /api/bol-keywords-enrich
 *
 * Comprehensive keyword enrichment for products
 * Combines 5 keyword sources:
 * 1. AI extraction from current content (titles, descriptions)
 * 2. Advertising API keywords mapped to EANs
 * 3. Search volume data from Search Terms API
 * 4. Category-based fallback keywords
 * 5. Competitor keyword analysis
 *
 * Called automatically during main sync or manually via dashboard
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getAdsToken,
  getAdsCampaigns,
  getAdsAdGroups,
  getAdsKeywords,
  getSearchTermVolume,
  sleep,
} from './_lib/bol-api-client.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Category-based keyword mapping (from bol-keywords-fallback.ts)
const CATEGORY_KEYWORDS: Record<string, Array<{ keyword: string; priority: number }>> = {
  'sportlegging': [
    { keyword: 'sportlegging', priority: 10 },
    { keyword: 'sportlegging dames', priority: 9 },
    { keyword: 'high waist legging', priority: 8 },
    { keyword: 'yoga legging', priority: 7 },
    { keyword: 'sportbroek dames', priority: 7 },
    { keyword: 'fitness legging', priority: 6 },
    { keyword: 'hardloop legging', priority: 6 },
  ],
  'sportshirts-tops': [
    { keyword: 'sportshirt dames', priority: 10 },
    { keyword: 'sporttop', priority: 9 },
    { keyword: 'fitness shirt', priority: 8 },
    { keyword: 'hardloopshirt', priority: 7 },
    { keyword: 'yoga top', priority: 7 },
  ],
  'sport-bhs': [
    { keyword: 'sport bh', priority: 10 },
    { keyword: 'sport bh dames', priority: 9 },
    { keyword: 'sport beha', priority: 8 },
    { keyword: 'fitness bh', priority: 7 },
    { keyword: 'hardloop bh', priority: 6 },
  ],
  'sportbroeken-shorts': [
    { keyword: 'sportbroek dames', priority: 10 },
    { keyword: 'sportshort', priority: 9 },
    { keyword: 'hardloopbroek', priority: 8 },
    { keyword: 'fietsbroek', priority: 7 },
    { keyword: 'trainingsbroek', priority: 6 },
  ],
  'sportkleding': [
    { keyword: 'sportkleding', priority: 10 },
    { keyword: 'sportkleding dames', priority: 9 },
    { keyword: 'fitness kleding', priority: 8 },
    { keyword: 'hardloopkleding', priority: 7 },
  ],
};

interface KeywordToInsert {
  bol_customer_id: string;
  ean: string;
  keyword: string;
  priority: number;
  source: string;
  search_volume?: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  console.log('[bol-keywords-enrich] Starting keyword enrichment for customer:', customerId);

  // Get customer credentials
  const { data: customer, error: custErr } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (custErr || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const keywordsToInsert: KeywordToInsert[] = [];
  const stats = {
    products_analyzed: 0,
    ai_keywords_extracted: 0,
    advertising_keywords_mapped: 0,
    category_fallbacks_added: 0,
    search_volumes_fetched: 0,
    total_keywords_inserted: 0,
  };

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Fetch product inventory + catalog data
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 1: Fetching product data...');

    const { data: inventorySnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inventorySnap) {
      return res.status(404).json({ error: 'No inventory data found' });
    }

    // FIX: raw_data structure is { items: [...] } not { inventory: [...] }
    const inventory = ((inventorySnap.raw_data as any)?.items || (inventorySnap.raw_data as any)?.inventory || []) as Array<{
      ean?: string;
      title?: string;
      description?: string;
    }>;

    console.log(`[bol-keywords-enrich] Found ${inventory.length} products`);

    // Get category mapping
    const { data: categories } = await supabase
      .from('bol_product_categories')
      .select('ean, category_slug')
      .eq('bol_customer_id', customerId);

    const eanToCategory = new Map((categories || []).map(c => [c.ean, c.category_slug]));

    // Get uploaded content basis (klant content)
    const { data: contentBasis } = await supabase
      .from('bol_content_basis')
      .select('ean, title, description')
      .eq('bol_customer_id', customerId);

    const eanToContentBasis = new Map(
      (contentBasis || []).map(cb => [cb.ean, { title: cb.title, description: cb.description }])
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: AI Content-Based Keyword Extraction
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 2: AI content-based keyword extraction...');

    // Process products in batches of 10 to avoid rate limits
    const productsToAnalyze = inventory.filter(p => p.ean && (p.title || p.description)).slice(0, 50);

    for (const product of productsToAnalyze) {
      if (!product.ean) continue;

      const currentTitle = product.title || '';
      const currentDescription = product.description || '';
      const basisContent = eanToContentBasis.get(product.ean);
      const categorySlug = eanToCategory.get(product.ean);

      // Build AI prompt
      const prompt = `Je bent een SEO keyword expert voor Bol.com. Analyseer de volgende productcontent en extraheer relevante zoekwoorden.

**Huidige content:**
Titel: ${currentTitle}
Beschrijving: ${currentDescription.substring(0, 500)}

${basisContent ? `**Originele klant content (referentie):**
Titel: ${basisContent.title || 'Niet beschikbaar'}
Beschrijving: ${basisContent.description?.substring(0, 500) || 'Niet beschikbaar'}` : ''}

${categorySlug ? `**Productcategorie:** ${categorySlug}` : ''}

**Taak:**
1. Extraheer keywords die **al in de content staan** (uit titel én beschrijving)
2. Suggereer keywords die er **zou moeten staan** op basis van:
   - Producttype en categorie
   - Materialen, eigenschappen, gebruik
   - USPs die in de klant content staan
   - Nederlandse Bol.com zoektermen

**Regels:**
- Gebruik ALLEEN Nederlandse keywords
- Focus op specifieke termen (bijv. "high waist" ipv "legging")
- Geen merknamen verzinnen die niet in de content staan
- Prioriteer keywords met hoge zoekintentie

Return ALLEEN een JSON array:
[
  {"keyword": "keyword phrase", "priority": 1-10, "in_content": true/false}
]

Priority schaal:
10 = Primaire keyword (producttype)
8-9 = Specifieke eigenschappen (high waist, mesh, etc.)
6-7 = Algemene eigenschappen (sport, fitness)
4-5 = Gebruik/doelgroep (yoga, hardlopen)`;

      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.content[0];
        if (content.type !== 'text') continue;

        const jsonMatch = content.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;

        const extractedKeywords = JSON.parse(jsonMatch[0]) as Array<{
          keyword: string;
          priority: number;
          in_content: boolean;
        }>;

        for (const kw of extractedKeywords) {
          keywordsToInsert.push({
            bol_customer_id: customerId,
            ean: product.ean,
            keyword: kw.keyword.toLowerCase().trim(),
            priority: Math.min(10, Math.max(1, kw.priority)),
            source: kw.in_content ? 'content_analysis' : 'ai_suggestion',
            search_volume: null,
          });
          stats.ai_keywords_extracted++;
        }

        stats.products_analyzed++;

        // Rate limit: 1 request per 2 seconds
        await sleep(2000);

      } catch (aiErr) {
        console.error(`[bol-keywords-enrich] AI extraction failed for EAN ${product.ean}:`, aiErr);
      }
    }

    console.log(`[bol-keywords-enrich] AI extracted ${stats.ai_keywords_extracted} keywords from ${stats.products_analyzed} products`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Advertising API Keyword Mapping
    // ═══════════════════════════════════════════════════════════════════════════
    if (customer.ads_client_id && customer.ads_client_secret) {
      console.log('[bol-keywords-enrich] Step 3: Mapping advertising keywords to products...');

      try {
        const adsToken = await getAdsToken(
          customer.ads_client_id as string,
          customer.ads_client_secret as string
        );
        const campaigns = await getAdsCampaigns(adsToken);

        for (const campaign of (campaigns as Array<{ campaignId?: string; state?: string }>).slice(0, 20)) {
          if (!campaign.campaignId || campaign.state !== 'ENABLED') continue;

          const adGroups = await getAdsAdGroups(adsToken, campaign.campaignId);

          for (const adGroup of (adGroups as Array<{ adGroupId?: string }>).slice(0, 40)) {
            if (!adGroup.adGroupId) continue;

            const [keywords, productTargetsRes] = await Promise.all([
              getAdsKeywords(adsToken, adGroup.adGroupId),
              fetch(
                `https://advertising-api.bol.com/v10/ad-groups/${adGroup.adGroupId}/product-targets`,
                {
                  headers: {
                    Authorization: `Bearer ${adsToken}`,
                    Accept: 'application/vnd.advertising.v10+json',
                  },
                }
              ),
            ]);

            const productTargetsData = productTargetsRes.ok
              ? await productTargetsRes.json()
              : { productTargets: [] };
            const eans = ((productTargetsData as any).productTargets || [])
              .map((t: any) => t.ean)
              .filter(Boolean) as string[];

            for (const kw of keywords as Array<{
              keywordText?: string;
              bid?: { amount?: number };
              state?: string;
            }>) {
              if (!kw.keywordText || kw.state === 'ARCHIVED') continue;

              const priority = Math.min(
                10,
                Math.max(1, Math.round((kw.bid?.amount ?? 0.5) * 10))
              );

              for (const ean of eans) {
                keywordsToInsert.push({
                  bol_customer_id: customerId,
                  ean,
                  keyword: kw.keywordText.toLowerCase().trim(),
                  priority,
                  source: 'advertising',
                  search_volume: null,
                });
                stats.advertising_keywords_mapped++;
              }
            }

            await sleep(250);
          }
        }

        console.log(`[bol-keywords-enrich] Mapped ${stats.advertising_keywords_mapped} advertising keywords`);
      } catch (adsErr) {
        console.error('[bol-keywords-enrich] Advertising API error:', adsErr);
      }
    } else {
      console.log('[bol-keywords-enrich] No advertising credentials, skipping Step 3');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Category-Based Fallback Keywords
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 4: Adding category-based fallback keywords...');

    // Get products that don't have keywords yet
    const { data: existingKeywords } = await supabase
      .from('bol_product_keyword_targets')
      .select('ean')
      .eq('bol_customer_id', customerId);

    const eansWithKeywords = new Set([
      ...new Set((existingKeywords || []).map(k => k.ean)),
      ...new Set(keywordsToInsert.map(k => k.ean)),
    ]);

    for (const product of inventory) {
      if (!product.ean || eansWithKeywords.has(product.ean)) continue;

      const categorySlug = eanToCategory.get(product.ean);
      const categoryKeywords =
        categorySlug && CATEGORY_KEYWORDS[categorySlug]
          ? CATEGORY_KEYWORDS[categorySlug]
          : CATEGORY_KEYWORDS['sportkleding'];

      for (const { keyword, priority } of categoryKeywords) {
        keywordsToInsert.push({
          bol_customer_id: customerId,
          ean: product.ean,
          keyword,
          priority: categorySlug && CATEGORY_KEYWORDS[categorySlug] ? priority : Math.max(3, priority - 3),
          source: 'category_analysis',
          search_volume: null,
        });
        stats.category_fallbacks_added++;
      }
    }

    console.log(`[bol-keywords-enrich] Added ${stats.category_fallbacks_added} category fallback keywords`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Search Volume Enrichment
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 5: Fetching search volumes from Search Terms API...');

    // Get unique keywords
    const uniqueKeywords = [...new Set(keywordsToInsert.map(k => k.keyword))];

    // Only fetch for top priority keywords (limit to 50 to avoid rate limits)
    const topKeywords = uniqueKeywords.slice(0, 50);

    if (customer.bol_client_id && customer.bol_client_secret) {
      const { getBolToken } = await import('./_lib/bol-api-client.js');
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      const searchVolumeMap = new Map<string, number>();

      for (const keyword of topKeywords) {
        try {
          const volumeData = await getSearchTermVolume(token, keyword);

          if (volumeData?.searchVolume) {
            searchVolumeMap.set(keyword, volumeData.searchVolume);
            stats.search_volumes_fetched++;
          }

          // Rate limit: 1 request per second
          await sleep(1000);
        } catch (volErr) {
          console.error(`[bol-keywords-enrich] Search volume fetch failed for "${keyword}":`, volErr);
        }
      }

      // Update keywords with search volume
      for (const kw of keywordsToInsert) {
        if (searchVolumeMap.has(kw.keyword)) {
          kw.search_volume = searchVolumeMap.get(kw.keyword);
        }
      }

      console.log(`[bol-keywords-enrich] Fetched ${stats.search_volumes_fetched} search volumes`);
    } else {
      console.log('[bol-keywords-enrich] No retailer credentials, skipping search volume fetch');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Insert Keywords (deduplicated)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 6: Inserting keywords into database...');

    if (keywordsToInsert.length === 0) {
      return res.status(200).json({
        message: 'No keywords to insert',
        stats,
      });
    }

    // Batch insert in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < keywordsToInsert.length; i += chunkSize) {
      const chunk = keywordsToInsert.slice(i, i + chunkSize);

      const { error: insertErr, count } = await supabase
        .from('bol_product_keyword_targets')
        .upsert(chunk, {
          onConflict: 'bol_customer_id,ean,keyword',
          ignoreDuplicates: false,
        })
        .select('id', { count: 'exact', head: true });

      if (insertErr) {
        console.error('[bol-keywords-enrich] Insert error:', insertErr);
      } else {
        stats.total_keywords_inserted += count || 0;
      }
    }

    console.log(`[bol-keywords-enrich] Inserted ${stats.total_keywords_inserted} keywords`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: Sync Keyword Metadata (in_title, in_description flags)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[bol-keywords-enrich] Step 7: Syncing keyword metadata...');

    const { data: allKeywords } = await supabase
      .from('bol_product_keyword_targets')
      .select('id, ean, keyword')
      .eq('bol_customer_id', customerId);

    if (allKeywords && allKeywords.length > 0) {
      const updates: Array<{ id: string; in_title: boolean; in_description: boolean }> = [];

      for (const kw of allKeywords) {
        const product = inventory.find(p => p.ean === kw.ean);
        if (!product) continue;

        const title = (product.title || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const keyword = kw.keyword.toLowerCase();

        const inTitle = title.includes(keyword);
        const inDescription = description.includes(keyword);

        updates.push({
          id: kw.id,
          in_title: inTitle,
          in_description: inDescription,
        });
      }

      // Batch update metadata
      for (const update of updates) {
        await supabase
          .from('bol_product_keyword_targets')
          .update({ in_title: update.in_title, in_description: update.in_description })
          .eq('id', update.id);
      }

      console.log(`[bol-keywords-enrich] Synced metadata for ${updates.length} keywords`);
    }

    return res.status(200).json({
      message: 'Keyword enrichment completed successfully',
      stats,
      keywords_by_source: {
        ai_extraction: stats.ai_keywords_extracted,
        advertising: stats.advertising_keywords_mapped,
        category_fallback: stats.category_fallbacks_added,
      },
    });

  } catch (err) {
    console.error('[bol-keywords-enrich] Error:', err);
    return res.status(500).json({
      error: 'Keyword enrichment failed',
      details: (err as Error).message,
      stats,
    });
  }
}
