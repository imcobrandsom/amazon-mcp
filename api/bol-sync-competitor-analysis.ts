/**
 * Bol.com Competitor Research Sync
 *
 * Data flow:
 * 1. Categorie detecteren via /products/{ean}/placement (catalog category IDs)
 * 2. Competitor discovery via /products/list per categorie
 * 3. Content enrichment via /catalog-products (attributes + beschrijving)
 * 4. Offers ophalen voor live prijzen
 * 5. AI analyse (title + attributes + beschrijving)
 * 6. Keyword volume validatie via /search-terms
 * 7. Category insights genereren
 *
 * Schedule: 30 minutes after bol-sync-extended (every 6 hours)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getProductList,
  getCatalogProduct,
  getSearchTermVolume,
  getProductPlacement,
  extractDeepestCategoryId,
  extractCategoryPath,
  sleep,
} from './_lib/bol-api-client.js';
import {
  analyzeCompetitorContent,
  generateCategoryInsights,
} from './_lib/bol-competitor-analysis.js';

function isAuthorised(req: VercelRequest): boolean {
  const cronSecret    = process.env.CRON_SECRET;
  const webhookSecret = process.env.BOL_WEBHOOK_SECRET;
  const auth          = req.headers['authorization'] ?? '';
  const manual        = req.headers['x-webhook-secret'];
  const internal      = req.headers['x-internal-call'];

  return (cronSecret && auth === `Bearer ${cronSecret}`)
      || (webhookSecret && manual === webhookSecret)
      || (internal === 'true') // Allow internal calls from bol-sync-trigger
      || false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const supabase = createAdminClient();
  const results: Array<{ customerId: string; status: string; detail: any }> = [];

  // Check if a specific customer ID is provided (for manual triggers)
  const requestedCustomerId = req.body?.customerId;
  const maxCategories = req.body?.maxCategories || 1; // Process only 1 category by default to avoid timeout

  try {
    // Get all active Bol.com customers (or specific one if requested)
    let query = supabase
      .from('bol_customers')
      .select('*')
      .eq('active', true);

    if (requestedCustomerId) {
      query = query.eq('id', requestedCustomerId);
    }

    const { data: customers, error: custError } = await query;

    if (custError) throw custError;
    if (!customers || customers.length === 0) {
      return res.status(200).json({ message: 'No active customers', results });
    }

    for (const customer of customers) {
      try {
        const result = await processCustomer(customer, supabase, maxCategories);
        results.push({
          customerId: customer.id,
          status: 'ok',
          detail: result,
        });
      } catch (err) {
        console.error(`Error processing customer ${customer.id}:`, err);
        results.push({
          customerId: customer.id,
          status: 'error',
          detail: {
            error: (err as Error).message,
            stack: (err as Error).stack,
          },
        });
      }
    }

    return res.status(200).json({
      message: 'Competitor analysis sync completed',
      results,
    });
  } catch (err) {
    console.error('Fatal error in competitor analysis sync:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
      results,
    });
  }
}

async function processCustomer(customer: any, supabase: any, maxCategories: number = 1) {
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  const detail: Record<string, any> = {};
  const stats = {
    categories_analyzed: 0,
    competitors_found: 0,
    keywords_analyzed: 0,
  };

  console.log(`[processCustomer] Max categories to process: ${maxCategories}`);

  // ── STAP 1: Categorie detecteren per eigen EAN via placement API ─────────
  console.log(`[processCustomer] STAP 1: Categorie detecteren via placement API`);

  // Haal top-50 EANs uit competitor snapshots (meest betrouwbare bron)
  const { data: competitorSnapshots } = await supabase
    .from('bol_competitor_snapshots')
    .select('ean')
    .eq('bol_customer_id', customer.id)
    .order('fetched_at', { ascending: false })
    .limit(200);

  if (!competitorSnapshots || competitorSnapshots.length === 0) {
    detail.categories = 'No competitor snapshots found. Run Extended Sync first.';
    return detail;
  }

  const eans = [...new Set(competitorSnapshots.map((s: any) => s.ean))].filter(Boolean).slice(0, 50);
  console.log(`[processCustomer] Gevonden ${eans.length} EANs uit competitor snapshots`);

  // Gebruik gisteren als datum (API accepteert geen vandaag)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  let categoriesDetected = 0;
  const categoryInserts = [];

  for (const ean of eans) {
    try {
      // Use placement API to get catalog category (compatible with /products/list)
      const placement = await getProductPlacement(token, ean);
      if (!placement) {
        console.log(`[processCustomer] Geen placement gevonden voor EAN ${ean}`);
        continue;
      }

      const categoryId = extractDeepestCategoryId(placement);
      if (!categoryId) {
        console.log(`[processCustomer] Geen categoryId in placement voor EAN ${ean}`);
        continue;
      }

      const categoryPath = extractCategoryPath(placement);
      const categoryName = categoryPath?.split(' > ').pop() ?? null;

      // Genereer slug van category naam
      const categorySlug = categoryName
        ? categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : `cat-${categoryId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

      categoryInserts.push({
        bol_customer_id: customer.id,
        ean,
        category_id: categoryId,
        category_name: categoryName,
        category_slug: categorySlug,
        category_path: categoryPath || categoryId,
        fetched_at: new Date().toISOString(),
      });

      categoriesDetected++;
      await sleep(200); // rate limiting
    } catch (err) {
      console.warn(`[processCustomer] Product placement mislukt voor EAN ${ean}:`, err);
    }
  }

  // UPSERT categories
  if (categoryInserts.length > 0) {
    await supabase.from('bol_product_categories').upsert(categoryInserts, {
      onConflict: 'bol_customer_id,ean',
      ignoreDuplicates: false,
    });
  }

  detail.categoriesDetected = `${categoriesDetected}/${eans.length} products`;
  console.log(`[processCustomer] Categorieën gedetecteerd: ${categoriesDetected}/${eans.length}`);

  // ── STAP 2: Haal unieke categorieën op ────────────────────────────────────
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name, category_slug, category_path')
    .eq('bol_customer_id', customer.id)
    .not('category_id', 'is', null);

  if (!categories || categories.length === 0) {
    detail.categories = 'No categories found';
    return detail;
  }

  // Group by category_id to get unique categories
  const uniqueCategories = new Map<string, {
    categoryId: string;
    categoryName: string;
    categorySlug: string;
    categoryPath: string;
  }>();

  for (const cat of categories) {
    if (!uniqueCategories.has(cat.category_id)) {
      uniqueCategories.set(cat.category_id, {
        categoryId: cat.category_id,
        categoryName: cat.category_name,
        categorySlug: cat.category_slug,
        categoryPath: cat.category_path,
      });
    }
  }

  detail.uniqueCategories = `${uniqueCategories.size} categories`;
  console.log(`[processCustomer] Unieke categorieën: ${uniqueCategories.size}`);

  // ── STAP 3: Process each category (limited by maxCategories to avoid timeout) ─
  const categoryResults: string[] = [];
  let processedCount = 0;

  // Check which categories have been fully analyzed (all products analyzed)
  // A category is "done" if it has analyzed products AND no unanalyzed products remain
  const { data: categoryAnalysisStatus } = await supabase.rpc('get_category_analysis_status', {
    p_customer_id: customer.id
  }).catch(() => ({ data: null })); // Fallback if RPC doesn't exist

  const fullyAnalyzedCategories = new Set<string>();

  // Fallback: check manually if RPC doesn't exist
  if (!categoryAnalysisStatus) {
    // Get all categories with catalog data
    const { data: allCatalog } = await supabase
      .from('bol_competitor_catalog')
      .select('category_slug, competitor_ean')
      .eq('bol_customer_id', customer.id);

    // Get all categories with analysis
    const { data: allAnalysis } = await supabase
      .from('bol_competitor_content_analysis')
      .select('category_slug, competitor_ean')
      .eq('bol_customer_id', customer.id);

    // Group by category
    const catalogByCategory = new Map<string, Set<string>>();
    const analysisByCategory = new Map<string, Set<string>>();

    (allCatalog || []).forEach((c: any) => {
      if (!catalogByCategory.has(c.category_slug)) {
        catalogByCategory.set(c.category_slug, new Set());
      }
      catalogByCategory.get(c.category_slug)!.add(c.competitor_ean);
    });

    (allAnalysis || []).forEach((a: any) => {
      if (!analysisByCategory.has(a.category_slug)) {
        analysisByCategory.set(a.category_slug, new Set());
      }
      analysisByCategory.get(a.category_slug)!.add(a.competitor_ean);
    });

    // A category is fully analyzed if all catalog EANs have been analyzed
    for (const [catSlug, catalogEans] of catalogByCategory.entries()) {
      const analyzedEans = analysisByCategory.get(catSlug) || new Set();
      const allAnalyzed = Array.from(catalogEans).every(ean => analyzedEans.has(ean));
      if (allAnalyzed && catalogEans.size > 0) {
        fullyAnalyzedCategories.add(catSlug);
      }
    }
  }

  const recentlySynced = fullyAnalyzedCategories;
  console.log(`[processCustomer] ${recentlySynced.size} categories fully analyzed, will process incomplete ones first`);

  for (const [catId, catInfo] of uniqueCategories.entries()) {
    // Skip categories that were recently synced
    if (recentlySynced.has(catInfo.categorySlug)) {
      console.log(`[processCustomer] Skipping ${catInfo.categorySlug} (recently synced)`);
      continue;
    }

    if (processedCount >= maxCategories) {
      console.log(`[processCustomer] Reached maxCategories limit (${maxCategories}), stopping`);
      const remaining = uniqueCategories.size - recentlySynced.size - processedCount;
      categoryResults.push(`... and ${remaining} more categories (run again to process)`);
      break;
    }

    try {
      const catResult = await processCategory(
        customer.id,
        catInfo,
        token,
        supabase,
        eans
      );
      stats.categories_analyzed++;
      stats.competitors_found += catResult.competitors_found || 0;
      stats.keywords_analyzed += catResult.keywords_analyzed || 0;
      categoryResults.push(`${catInfo.categorySlug}: ${catResult.message}`);
      processedCount++;
    } catch (err) {
      console.error(`Error processing category ${catInfo.categorySlug}:`, err);
      categoryResults.push(`${catInfo.categorySlug}: error - ${(err as Error).message}`);
      processedCount++;
    }

    // Rate limit between categories
    await sleep(1000);
  }

  detail.categoryResults = categoryResults.join('; ');
  detail.categories_analyzed = stats.categories_analyzed;
  detail.competitors_found = stats.competitors_found;
  detail.keywords_analyzed = stats.keywords_analyzed;
  return detail;
}

async function processCategory(
  customerId: string,
  category: {
    categoryId: string;
    categoryName: string;
    categorySlug: string;
    categoryPath: string;
  },
  token: string,
  supabase: any,
  customerEans: string[]
): Promise<string> {
  console.log(`[processCategory] Processing ${category.categorySlug} (ID: ${category.categoryId})`);

  // Get customer's product EANs in this category
  const { data: yourProducts } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', customerId)
    .eq('category_id', category.categoryId);

  const yourEans = new Set((yourProducts || []).map((p: any) => p.ean));

  if (yourEans.size === 0) {
    return 'No products in category';
  }

  console.log(`[processCategory] ${yourEans.size} eigen producten in ${category.categorySlug}`);

  // ── STAP 3C: Competitor discovery via /products/list ──────────────────────
  console.log(`[processCategory] STAP 3C: Competitor discovery via /products/list`);

  const competitorEans = new Map<string, string>(); // ean → title

  // Pagineer door category producten (max 10 pagina's = 500 producten)
  let totalProducts = 0;
  let ownProductsFiltered = 0;

  for (let page = 1; page <= 10; page++) {
    try {
      const { products } = await getProductList(token, {
        categoryId: category.categoryId,
        sort: 'POPULARITY',
        page,
      });

      if (products.length === 0) {
        console.log(`[processCategory] Pagina ${page}: geen producten meer, stoppen`);
        break;
      }

      totalProducts += products.length;

      for (const product of products) {
        const ean = product.eans?.[0]?.ean;
        if (!ean) {
          console.log(`[processCategory] Product zonder EAN: ${product.title}`);
          continue;
        }
        if (yourEans.has(ean)) {
          ownProductsFiltered++;
          continue; // filter eigen producten
        }
        competitorEans.set(ean, product.title);
      }

      console.log(`[processCategory] Pagina ${page}: ${products.length} producten (${ownProductsFiltered} eigen), totaal ${competitorEans.size} concurrenten`);
      await sleep(150);
    } catch (err) {
      console.warn(`[processCategory] Product list mislukt pagina ${page}:`, err);
      break;
    }
  }

  console.log(`[processCategory] STAP 3C resultaat: ${totalProducts} producten gezien, ${ownProductsFiltered} eigen gefilterd, ${competitorEans.size} concurrenten gevonden`);

  console.log(`[processCategory] Totaal ${competitorEans.size} concurrenten gevonden`);

  // UPSERT in bol_competitor_catalog (title komt uit list response)
  const catalogInserts = Array.from(competitorEans.entries()).map(([ean, title]) => ({
    bol_customer_id: customerId,
    competitor_ean: ean,
    category_slug: category.categorySlug,
    category_id: category.categoryId,
    title,
    is_customer_product: false,
    fetched_at: new Date().toISOString(),
  }));

  if (catalogInserts.length > 0) {
    console.log(`[processCategory] Inserting ${catalogInserts.length} competitors in database`);
    await supabase
      .from('bol_competitor_catalog')
      .upsert(catalogInserts, { onConflict: 'bol_customer_id,competitor_ean,category_slug' });
  } else {
    console.warn(`[processCategory] ⚠️ GEEN COMPETITORS gevonden voor ${category.categorySlug}!`);
    console.warn(`[processCategory] Mogelijke oorzaken: alle producten zijn eigen producten, of categorie is leeg`);
  }

  // ── STAP 3D: Content enrichment via getCatalogProduct ─────────────────────
  console.log(`[processCategory] STAP 3D: Content enrichment`);

  // Alleen EANs die nog geen content hebben of ouder dan 7 dagen zijn
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: staleCompetitors } = await supabase
    .from('bol_competitor_catalog')
    .select('competitor_ean, category_slug')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug)
    .or(`description.is.null,fetched_at.lt.${sevenDaysAgo.toISOString()}`)
    .limit(50); // Limit to 50 to avoid timeout (50 × 200ms = 10s)

  console.log(`[processCategory] Content enrichment: processing ${staleCompetitors?.length ?? 0} products (max 50 per run)`);

  let enriched = 0;
  for (const comp of staleCompetitors ?? []) {
    try {
      const catalogData = await getCatalogProduct(token, comp.competitor_ean);
      if (!catalogData) continue;

      const typed = catalogData as any;

      // Extraheer brand uit parties[]
      const brand = typed.parties?.find(
        (p: { role: string }) => p.role === 'BRAND'
      )?.name ?? null;

      // Extraheer beschrijving uit attributes[]
      const description = extractAttributeDescription(typed.attributes ?? []);

      await supabase
        .from('bol_competitor_catalog')
        .update({
          brand,
          description,
          attributes: typed.attributes ?? [],
          fetched_at: new Date().toISOString(),
        })
        .eq('bol_customer_id', customerId)
        .eq('competitor_ean', comp.competitor_ean)
        .eq('category_slug', category.categorySlug);

      enriched++;
      await sleep(200);
    } catch (err) {
      console.warn(`[processCategory] Catalog enrichment mislukt voor ${comp.competitor_ean}:`, err);
    }
  }

  console.log(`[processCategory] Content enrichment: ${enriched}/${staleCompetitors?.length ?? 0} producten verrijkt`);

  // ── STAP 6: AI analyse ────────────────────────────────────────────────────
  console.log(`[processCategory] STAP 6: AI analyse`);

  // Get EANs that already have analysis
  const { data: existingAnalysis } = await supabase
    .from('bol_competitor_content_analysis')
    .select('competitor_ean')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug);

  const analyzedEans = new Set((existingAnalysis || []).map((a: any) => a.competitor_ean));
  console.log(`[processCategory] Already analyzed: ${analyzedEans.size} products`);

  // Get ALL catalog products for this category
  const { data: allCatalogProducts } = await supabase
    .from('bol_competitor_catalog')
    .select('competitor_ean, title, description, brand, list_price, attributes')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug);

  // Filter to only products that haven't been analyzed yet, then limit to 50
  const catalogProducts = (allCatalogProducts || [])
    .filter((p: any) => !analyzedEans.has(p.competitor_ean))
    .slice(0, 50); // Process 50 unanalyzed products per run

  console.log(`[processCategory] Found ${(allCatalogProducts || []).length} total products, analyzing ${catalogProducts.length} new ones`);

  const productsToAnalyze = (catalogProducts ?? []).map((c: any) => ({
    competitor_ean: c.competitor_ean,
    title: c.title,
    description: c.description,
    brand: c.brand,
    list_price: c.list_price,
    attributes: c.attributes,
  }));

  const analysisResults = await analyzeCompetitorContent(
    category.categorySlug,
    productsToAnalyze
  );

  // Store analysis results met UPSERT
  const analysisInserts = analysisResults.map(r => ({
    bol_customer_id: customerId,
    category_slug: category.categorySlug,
    competitor_ean: r.ean,
    title_score: r.title_score,
    title_length: r.title_length,
    description_score: r.description_score,
    description_length: r.description_length,
    extracted_keywords: r.keywords,
    extracted_usps: r.usps,
    content_quality: { notes: r.quality_notes },
    analyzed_at: new Date().toISOString(),
  }));

  if (analysisInserts.length > 0) {
    await supabase
      .from('bol_competitor_content_analysis')
      .upsert(analysisInserts, { onConflict: 'bol_customer_id,competitor_ean,category_slug' });
  }

  console.log(`[processCategory] AI analyse: ${analysisInserts.length} producten geanalyseerd`);

  // ── STAP 8: Generate category insights ────────────────────────────────────
  console.log(`[processCategory] STAP 8: Category insights genereren`);

  // Get your prices
  const { data: yourPriceData } = await supabase
    .from('bol_competitor_snapshots')
    .select('ean, our_price')
    .eq('bol_customer_id', customerId)
    .in('ean', Array.from(yourEans));

  const yourProductsWithPrices = (yourPriceData || []).map((p: any) => ({
    ean: p.ean,
    our_price: p.our_price,
  }));

  // Get ALL catalog data for this category (not just newly inserted)
  const { data: allCatalogData } = await supabase
    .from('bol_competitor_catalog')
    .select('competitor_ean, title, brand, list_price, is_customer_product')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug);

  const allCatalogInserts = (allCatalogData || []).map((c: any) => ({
    bol_customer_id: customerId,
    competitor_ean: c.competitor_ean,
    category_slug: category.categorySlug,
    category_id: category.categoryId,
    title: c.title,
    brand: c.brand,
    list_price: c.list_price,
    is_customer_product: c.is_customer_product ?? false,
  }));

  console.log(`[processCategory] Generating insights for ${allCatalogInserts.length} total competitors in category`);

  await generateCategoryInsights(
    customerId,
    category.categorySlug,
    category.categoryId,
    category.categoryPath,
    yourProductsWithPrices,
    allCatalogInserts,
    analysisInserts,
    supabase
  );

  // ── STAP 7: Keyword volume validatie (SKIPPED for performance) ────────────
  console.log(`[processCategory] STAP 7: Keyword volume validatie (skipped for performance)`);

  // Haal de laatst gegenereerde insights op
  const { data: insight } = await supabase
    .from('bol_category_insights')
    .select('trending_keywords')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  // SKIP keyword volume validation for now (too slow - 20 keywords × 200ms = 4s per category)
  // if (insight?.trending_keywords) {
  //   const keywords = (insight.trending_keywords as Array<{
  //     keyword: string; frequency: number; search_volume?: number | null; trend: string;
  //   }>).slice(0, 20);
  //
  //   const enrichedKeywords = [];
  //   for (const kw of keywords) {
  //     try {
  //       const volumeData = await getSearchTermVolume(token, kw.keyword);
  //       enrichedKeywords.push({
  //         ...kw,
  //         search_volume: volumeData?.total ?? null,
  //       });
  //       await sleep(200);
  //     } catch {
  //       enrichedKeywords.push(kw);
  //     }
  //   }
  //
  //   // Update category insights met zoekvolumes
  //   await supabase
  //     .from('bol_category_insights')
  //     .update({ trending_keywords: enrichedKeywords })
  //     .eq('bol_customer_id', customerId)
  //     .eq('category_slug', category.categorySlug)
  //     .order('generated_at', { ascending: false })
  //     .limit(1);
  //
  //   console.log(`[processCategory] Keyword volumes toegevoegd voor ${enrichedKeywords.length} keywords`);
  // }
  console.log(`[processCategory] Keyword volume validation skipped (performance optimization)`);

  const keywordCount = insight?.trending_keywords ? (insight.trending_keywords as any[]).length : 0;

  return {
    message: `${catalogInserts.length} products, ${enriched} enriched, ${analysisInserts.length} analyzed`,
    competitors_found: catalogInserts.length,
    keywords_analyzed: keywordCount,
  };
}

/**
 * Extraheer een leesbare beschrijving uit Bol.com attributes[].
 * Zoekt naar attribute IDs die gerelateerd zijn aan beschrijving/specificaties.
 */
function extractAttributeDescription(
  attributes: Array<{ id: string; values: Array<{ value: string; unitId?: string }> }>
): string {
  // Bol.com attribute IDs voor beschrijving/productomschrijving
  const descriptionIds = [
    'Producttekst', 'Omschrijving', 'Productomschrijving',
    'Description', 'Product Description', 'Selling points',
  ];
  const specIds = [
    'Materiaal', 'Material', 'Kleur', 'Colour', 'Color',
    'Maat', 'Size', 'Gewicht', 'Doelgroep',
  ];

  const descAttr = attributes.find(a => descriptionIds.includes(a.id));
  if (descAttr) {
    return descAttr.values.map(v => v.value).join(' ');
  }

  // Fallback: combineer spec-attributen
  const specs = attributes
    .filter(a => specIds.includes(a.id))
    .map(a => `${a.id}: ${a.values.map(v => v.value + (v.unitId ? ` ${v.unitId}` : '')).join(', ')}`)
    .join(' | ');
  return specs || '';
}
