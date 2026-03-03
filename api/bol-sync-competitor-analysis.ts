/**
 * Bol.com Competitor Research Sync — VOLLEDIG HERSCHREVEN
 *
 * Nieuwe 8-stappen data flow:
 * 1. Categorieboom ophalen (platte Map voor lookups)
 * 2. Categorie detecteren via product-ranks API (officële categoryId's)
 * 3. Competitor discovery via /products/list per categorie
 * 4. Content enrichment via /catalog-products (attributes + beschrijving)
 * 5. Offers ophalen voor live prijzen (bestaand)
 * 6. AI analyse (title + attributes + beschrijving)
 * 7. Keyword volume validatie via /search-terms
 * 8. Category insights genereren (bestaand + verbeterd)
 *
 * Schedule: 30 minutes after bol-sync-extended (every 6 hours)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getProductCategories,
  flattenCategoryTree,
  getProductRanks,
  getProductList,
  getCatalogProduct,
  getSearchTermVolume,
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
        const result = await processCustomer(customer, supabase);
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

async function processCustomer(customer: any, supabase: any) {
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  const detail: Record<string, any> = {};
  const stats = {
    categories_analyzed: 0,
    competitors_found: 0,
    keywords_analyzed: 0,
  };

  // ── STAP 1: Categorieboom ophalen ─────────────────────────────────────────
  console.log(`[processCustomer] STAP 1: Categorieboom ophalen`);
  const categoryTree = await getProductCategories(token);
  const categoryMap = flattenCategoryTree(categoryTree);
  detail.categoryTreeSize = `${categoryMap.size} categories`;
  console.log(`[processCustomer] Categorieboom geladen: ${categoryMap.size} categorieën`);

  // ── STAP 2: Categorie detecteren per eigen EAN ────────────────────────────
  console.log(`[processCustomer] STAP 2: Categorie detecteren`);

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
      const { ranks } = await getProductRanks(token, ean, dateStr, 'BROWSE');
      if (ranks.length === 0) {
        console.log(`[processCustomer] Geen ranks gevonden voor EAN ${ean}`);
        continue;
      }

      // Neem de categorie met de hoogste impressions als primaire categorie
      const topRank = ranks.reduce((best, r) =>
        r.impressions > best.impressions ? r : best, ranks[0]
      );

      const categoryId = topRank.categoryId;
      const categoryName = categoryMap.get(categoryId) ?? 'Onbekend';

      // Genereer slug vanuit naam (veiliger dan van path)
      const categorySlug = categoryName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      categoryInserts.push({
        bol_customer_id: customer.id,
        ean,
        category_id: categoryId,
        category_name: categoryName,
        category_slug: categorySlug,
        category_path: categoryName, // Voor backward compatibility
        fetched_at: new Date().toISOString(),
      });

      categoriesDetected++;
      await sleep(200); // rate limiting
    } catch (err) {
      console.warn(`[processCustomer] Product ranks mislukt voor EAN ${ean}:`, err);
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

  // ── STAP 3: Haal unieke categorieën op ────────────────────────────────────
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

  // ── STAP 4: Process each category ─────────────────────────────────────────
  const categoryResults: string[] = [];

  for (const [catId, catInfo] of uniqueCategories.entries()) {
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
    } catch (err) {
      console.error(`Error processing category ${catInfo.categorySlug}:`, err);
      categoryResults.push(`${catInfo.categorySlug}: error - ${(err as Error).message}`);
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
  for (let page = 1; page <= 10; page++) {
    try {
      const { products } = await getProductList(token, {
        categoryId: category.categoryId,
        sort: 'POPULARITY',
        page,
      });

      if (products.length === 0) break;

      for (const product of products) {
        const ean = product.eans?.[0]?.ean;
        if (!ean) continue;
        if (yourEans.has(ean)) continue; // filter eigen producten
        competitorEans.set(ean, product.title);
      }

      console.log(`[processCategory] Pagina ${page}: ${products.length} producten, totaal ${competitorEans.size} concurrenten`);
      await sleep(150);
    } catch (err) {
      console.warn(`[processCategory] Product list mislukt pagina ${page}:`, err);
      break;
    }
  }

  console.log(`[processCategory] Totaal ${competitorEans.size} concurrenten gevonden`);

  // UPSERT in bol_competitor_catalog (title komt uit list response)
  const catalogInserts = Array.from(competitorEans.entries()).map(([ean, title]) => ({
    bol_customer_id: customerId,
    competitor_ean: ean,
    category_slug: category.categorySlug,
    category_id: category.categoryId,
    title,
    title_raw: title,
    is_customer_product: false,
    fetched_at: new Date().toISOString(),
  }));

  if (catalogInserts.length > 0) {
    await supabase
      .from('bol_competitor_catalog')
      .upsert(catalogInserts, { onConflict: 'bol_customer_id,competitor_ean,category_slug' });
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
    .or(`description.is.null,fetched_at.lt.${sevenDaysAgo.toISOString()}`);

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

  // Haal volledige catalog data op voor analyse
  const { data: catalogProducts } = await supabase
    .from('bol_competitor_catalog')
    .select('competitor_ean, title, description, brand, list_price, attributes')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug)
    .limit(100);

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

  await generateCategoryInsights(
    customerId,
    category.categorySlug,
    category.categoryId,
    category.categoryPath,
    yourProductsWithPrices,
    catalogInserts,
    analysisInserts,
    supabase
  );

  // ── STAP 7: Keyword volume validatie ──────────────────────────────────────
  console.log(`[processCategory] STAP 7: Keyword volume validatie`);

  // Haal de laatst gegenereerde insights op
  const { data: insight } = await supabase
    .from('bol_category_insights')
    .select('trending_keywords')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (insight?.trending_keywords) {
    const keywords = (insight.trending_keywords as Array<{
      keyword: string; frequency: number; search_volume?: number | null; trend: string;
    }>).slice(0, 20);

    const enrichedKeywords = [];
    for (const kw of keywords) {
      try {
        const volumeData = await getSearchTermVolume(token, kw.keyword);
        enrichedKeywords.push({
          ...kw,
          search_volume: volumeData?.total ?? null,
        });
        await sleep(200);
      } catch {
        enrichedKeywords.push(kw);
      }
    }

    // Update category insights met zoekvolumes
    await supabase
      .from('bol_category_insights')
      .update({ trending_keywords: enrichedKeywords })
      .eq('bol_customer_id', customerId)
      .eq('category_slug', category.categorySlug)
      .order('generated_at', { ascending: false })
      .limit(1);

    console.log(`[processCategory] Keyword volumes toegevoegd voor ${enrichedKeywords.length} keywords`);
  }

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
