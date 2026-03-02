/**
 * Bol.com Competitor Research Sync
 *
 * Runs after bol-sync-extended to:
 * 1. Extract categories from customer's products
 * 2. Discover all products in each category via Bol.com API
 * 3. Fetch catalog data for top competitors
 * 4. Run AI content analysis
 * 5. Generate category-level insights
 *
 * Schedule: 30 minutes after bol-sync-extended (every 6 hours)
 */

import { createAdminClient } from './_lib/supabase-admin';
import {
  getBolToken,
  getCatalogProduct,
  getProductsByCategory,
} from './_lib/bol-api-client';
import { extractCategory, parseProductListItem } from './_lib/bol-category-extractor';
import {
  analyzeCompetitorContent,
  generateCategoryInsights,
} from './_lib/bol-competitor-analysis';

export default async function handler(req: Request) {
  const supabase = createAdminClient();
  const results: Array<{ customerId: string; status: string; detail: any }> = [];

  try {
    // Get all active Bol.com customers
    const { data: customers, error: custError } = await supabase
      .from('bol_customers')
      .select('*')
      .eq('is_active', true);

    if (custError) throw custError;
    if (!customers || customers.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active customers', results }),
        { status: 200 }
      );
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
          detail: { error: (err as Error).message },
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Competitor analysis sync completed',
        results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Fatal error in competitor analysis sync:', err);
    return new Response(
      JSON.stringify({
        error: (err as Error).message,
        results,
      }),
      { status: 500 }
    );
  }
}

async function processCustomer(customer: any, supabase: any) {
  const token = await getBolToken(customer.client_id, customer.client_secret);
  const detail: Record<string, string> = {};

  // ── Step 1: Extract categories from customer's products ──────────────
  // Get latest catalog snapshots
  const { data: rawSnapshots } = await supabase
    .from('bol_raw_snapshots')
    .select('raw_data')
    .eq('bol_customer_id', customer.id)
    .eq('data_type', 'listings')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!rawSnapshots?.raw_data?.catalog) {
    detail.categories = 'No catalog data available yet';
    return detail;
  }

  const catalogData = rawSnapshots.raw_data.catalog as Record<string, any>;
  const eans = Object.keys(catalogData);

  // Extract categories and store
  const categoryInserts = [];
  for (const ean of eans) {
    const catalog = catalogData[ean];
    if (!catalog) continue;

    const { categoryId, categoryPath, categorySlug } = extractCategory(catalog);
    const title = catalog.title || catalog.name || null;
    const brand = catalog.brand || null;

    categoryInserts.push({
      bol_customer_id: customer.id,
      ean,
      category_id: categoryId,
      category_path: categoryPath,
      category_slug: categorySlug,
      brand,
      title,
      fetched_at: new Date().toISOString(),
    });
  }

  if (categoryInserts.length > 0) {
    // Upsert categories
    await supabase.from('bol_product_categories').upsert(categoryInserts, {
      onConflict: 'bol_customer_id,ean',
      ignoreDuplicates: false,
    });
  }

  detail.categoriesExtracted = `${categoryInserts.length} products`;

  // ── Step 2: Get unique categories ─────────────────────────────────────
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_slug, category_path')
    .eq('bol_customer_id', customer.id)
    .order('category_slug');

  if (!categories || categories.length === 0) {
    detail.categories = 'No categories found';
    return detail;
  }

  // Group by category_slug to get unique categories
  const uniqueCategories = new Map<string, {
    categoryId: string | null;
    categorySlug: string;
    categoryPath: string;
  }>();

  for (const cat of categories) {
    if (!uniqueCategories.has(cat.category_slug)) {
      uniqueCategories.set(cat.category_slug, {
        categoryId: cat.category_id,
        categorySlug: cat.category_slug,
        categoryPath: cat.category_path,
      });
    }
  }

  detail.uniqueCategories = `${uniqueCategories.size} categories`;

  // ── Step 3: Process each category ─────────────────────────────────────
  const categoryResults: string[] = [];

  for (const [slug, catInfo] of uniqueCategories.entries()) {
    try {
      const catResult = await processCategory(
        customer.id,
        catInfo,
        token,
        supabase
      );
      categoryResults.push(`${slug}: ${catResult}`);
    } catch (err) {
      console.error(`Error processing category ${slug}:`, err);
      categoryResults.push(`${slug}: error - ${(err as Error).message}`);
    }

    // Rate limit between categories
    await sleep(1000);
  }

  detail.categoryResults = categoryResults.join('; ');
  return detail;
}

async function processCategory(
  customerId: string,
  category: {
    categoryId: string | null;
    categorySlug: string;
    categoryPath: string;
  },
  token: string,
  supabase: any
): Promise<string> {
  // Get customer's product EANs in this category
  const { data: yourProducts } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', customerId)
    .eq('category_slug', category.categorySlug);

  const yourEans = new Set((yourProducts || []).map((p: any) => p.ean));

  if (yourEans.size === 0) {
    return 'No products in category';
  }

  // ── Discover all products in category via API ─────────────────────────
  if (!category.categoryId) {
    return 'No categoryId available, skipping discovery';
  }

  let allProducts: any[] = [];
  let page = 1;
  const maxPages = 4; // Limit to 200 products (50 per page)

  while (page <= maxPages) {
    const { products, totalCount } = await getProductsByCategory(token, {
      categoryId: category.categoryId,
      countryCode: 'NL',
      page,
    });

    if (products.length === 0) break;

    allProducts.push(...products);
    page++;

    // Rate limit
    await sleep(200);

    // Stop if we've fetched all products
    if (allProducts.length >= totalCount) break;
  }

  if (allProducts.length === 0) {
    return 'No products found in category';
  }

  // ── Parse and store competitor catalog data ───────────────────────────
  const catalogInserts = [];

  for (const product of allProducts) {
    const parsed = parseProductListItem(product);
    if (!parsed.ean) continue;

    const isCustomerProduct = yourEans.has(parsed.ean);

    catalogInserts.push({
      bol_customer_id: customerId,
      category_slug: category.categorySlug,
      category_id: category.categoryId,
      competitor_ean: parsed.ean,
      title: parsed.title,
      description: null, // Will be enriched with full catalog data later
      brand: parsed.brand,
      list_price: parsed.listPrice,
      is_customer_product: isCustomerProduct,
      relevance_score: null,
      attributes: null,
      fetched_at: new Date().toISOString(),
    });
  }

  if (catalogInserts.length > 0) {
    await supabase.from('bol_competitor_catalog').insert(catalogInserts);
  }

  // ── Fetch full catalog data for top 100 competitors ───────────────────
  const competitors = catalogInserts.filter(c => !c.is_customer_product);
  const top100 = competitors.slice(0, 100);

  let enriched = 0;
  for (const comp of top100) {
    try {
      const catalog = await getCatalogProduct(token, comp.competitor_ean);
      if (catalog) {
        comp.description = (catalog as any).description || null;
        comp.attributes = (catalog as any).attributes || null;
        enriched++;
      }
    } catch (_) {
      // Skip individual failures
    }
    await sleep(150); // Rate limit
  }

  // Update competitor catalog with full data
  for (const comp of top100) {
    if (comp.description || comp.attributes) {
      await supabase
        .from('bol_competitor_catalog')
        .update({
          description: comp.description,
          attributes: comp.attributes,
        })
        .eq('bol_customer_id', customerId)
        .eq('category_slug', category.categorySlug)
        .eq('competitor_ean', comp.competitor_ean)
        .gte('fetched_at', new Date(Date.now() - 60000).toISOString()); // Last minute
    }
  }

  // ── Run AI content analysis ───────────────────────────────────────────
  const productsToAnalyze = top100.map(c => ({
    competitor_ean: c.competitor_ean,
    title: c.title,
    description: c.description,
    brand: c.brand,
    list_price: c.list_price,
  }));

  const analysisResults = await analyzeCompetitorContent(
    category.categorySlug,
    productsToAnalyze
  );

  // Store analysis results
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
    await supabase.from('bol_competitor_content_analysis').insert(analysisInserts);
  }

  // ── Generate category-level insights ──────────────────────────────────
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

  return `${catalogInserts.length} products, ${enriched} enriched, ${analysisInserts.length} analyzed`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
