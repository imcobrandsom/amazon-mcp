/**
 * Core keyword enrichment logic (shared between HTTP endpoint and sync-trigger)
 */
import { createAdminClient } from './supabase-admin.js';
import {
  getAdsToken,
  getAdsCampaigns,
  getAdsAdGroups,
  getAdsKeywords,
  getBolToken,
  getSearchTermVolume,
  sleep,
} from './bol-api-client.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Category-based keyword mapping
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

export interface KeywordEnrichmentStats {
  products_analyzed: number;
  ai_keywords_extracted: number;
  advertising_keywords_mapped: number;
  category_fallbacks_added: number;
  search_volumes_fetched: number;
  total_keywords_inserted: number;
}

export async function enrichKeywordsForCustomer(customerId: string): Promise<{
  success: boolean;
  stats: KeywordEnrichmentStats;
  error?: string;
}> {
  const supabase = createAdminClient();

  console.log('[bol-keywords-enrich-core] Starting enrichment for customer:', customerId);

  const stats: KeywordEnrichmentStats = {
    products_analyzed: 0,
    ai_keywords_extracted: 0,
    advertising_keywords_mapped: 0,
    category_fallbacks_added: 0,
    search_volumes_fetched: 0,
    total_keywords_inserted: 0,
  };

  try {
    // Get customer credentials
    const { data: customer, error: custErr } = await supabase
      .from('bol_customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (custErr || !customer) {
      return { success: false, stats, error: 'Customer not found' };
    }

    const keywordsToInsert: KeywordToInsert[] = [];

    // STEP 1: Fetch product inventory
    console.log('[enrich] Step 1: Fetching product data...');

    const { data: inventorySnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inventorySnap) {
      return { success: false, stats, error: 'No inventory data found' };
    }

    const inventory = ((inventorySnap.raw_data as any)?.items || (inventorySnap.raw_data as any)?.inventory || []) as Array<{
      ean?: string;
      title?: string;
      description?: string;
    }>;

    console.log(`[enrich] Found ${inventory.length} products`);

    // Get category mapping
    const { data: categories } = await supabase
      .from('bol_product_categories')
      .select('ean, category_slug')
      .eq('bol_customer_id', customerId);

    const eanToCategory = new Map((categories || []).map(c => [c.ean, c.category_slug]));

    // Get uploaded content basis
    const { data: contentBasis } = await supabase
      .from('bol_content_basis')
      .select('ean, title, description')
      .eq('bol_customer_id', customerId);

    const eanToContentBasis = new Map(
      (contentBasis || []).map(cb => [cb.ean, { title: cb.title, description: cb.description }])
    );

    // STEP 2: AI Content-Based Keyword Extraction
    console.log('[enrich] Step 2: AI content extraction (TEMP DISABLED - too slow)...');

    // TEMP: Skip AI to avoid timeout - will re-enable after testing basic flow
    const productsToAnalyze = []; // inventory.filter(p => p.ean && (p.title || p.description)).slice(0, 50);

    for (const product of productsToAnalyze) {
      if (!product.ean) continue;

      const currentTitle = product.title || '';
      const currentDescription = product.description || '';
      const basisContent = eanToContentBasis.get(product.ean);
      const categorySlug = eanToCategory.get(product.ean);

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
        await sleep(2000); // Rate limit

      } catch (aiErr) {
        console.error(`[enrich] AI extraction failed for EAN ${product.ean}:`, aiErr);
      }
    }

    console.log(`[enrich] AI extracted ${stats.ai_keywords_extracted} keywords from ${stats.products_analyzed} products`);

    // STEP 3: Advertising API Keyword Mapping
    if (customer.ads_client_id && customer.ads_client_secret) {
      console.log('[enrich] Step 3: Mapping advertising keywords...');

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

        console.log(`[enrich] Mapped ${stats.advertising_keywords_mapped} advertising keywords`);
      } catch (adsErr) {
        console.error('[enrich] Advertising API error:', adsErr);
      }
    }

    // STEP 4: Category-Based Fallback Keywords
    console.log('[enrich] Step 4: Adding category fallback keywords...');

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

    console.log(`[enrich] Added ${stats.category_fallbacks_added} category fallback keywords`);

    // STEP 5: Search Volume Enrichment (optional, skip for now to save time)
    console.log('[enrich] Step 5: Skipping search volume fetch (saves ~50s)');

    // STEP 6: Insert Keywords
    console.log(`[enrich] Step 6: Inserting ${keywordsToInsert.length} keywords...`);

    if (keywordsToInsert.length === 0) {
      console.log('[enrich] No keywords to insert, returning');
      return { success: true, stats };
    }

    const chunkSize = 500;
    let totalInserted = 0;
    let totalErrors = 0;

    for (let i = 0; i < keywordsToInsert.length; i += chunkSize) {
      const chunk = keywordsToInsert.slice(i, i + chunkSize);
      console.log(`[enrich] Upserting chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(keywordsToInsert.length / chunkSize)} (${chunk.length} keywords)...`);

      const { error: insertErr, count } = await supabase
        .from('bol_product_keyword_targets')
        .upsert(chunk, {
          onConflict: 'bol_customer_id,ean,keyword',
          ignoreDuplicates: false,
        })
        .select('id', { count: 'exact', head: true });

      if (insertErr) {
        console.error(`[enrich] Insert error for chunk ${Math.floor(i / chunkSize) + 1}:`, insertErr.message);
        console.error('[enrich] Error details:', JSON.stringify(insertErr));
        totalErrors++;
      } else {
        const inserted = count || 0;
        totalInserted += inserted;
        console.log(`[enrich] Chunk ${Math.floor(i / chunkSize) + 1}: inserted ${inserted} keywords`);
      }
    }

    stats.total_keywords_inserted = totalInserted;
    console.log(`[enrich] Total inserted: ${stats.total_keywords_inserted} keywords (${totalErrors} chunk errors)`);

    // STEP 7: Sync Metadata
    console.log('[enrich] Step 7: Syncing metadata...');

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

        updates.push({
          id: kw.id,
          in_title: title.includes(keyword),
          in_description: description.includes(keyword),
        });
      }

      for (const update of updates) {
        await supabase
          .from('bol_product_keyword_targets')
          .update({ in_title: update.in_title, in_description: update.in_description })
          .eq('id', update.id);
      }

      console.log(`[enrich] Synced metadata for ${updates.length} keywords`);
    }

    return { success: true, stats };

  } catch (err) {
    console.error('[bol-keywords-enrich-core] Error:', err);
    return {
      success: false,
      stats,
      error: (err as Error).message,
    };
  }
}
