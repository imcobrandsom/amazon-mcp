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

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getCatalogProduct,
  getProductsByCategory,
} from './_lib/bol-api-client.js';
import { extractCategory, parseProductListItem } from './_lib/bol-category-extractor.js';
import {
  analyzeCompetitorContent,
  generateCategoryInsights,
} from './_lib/bol-competitor-analysis.js';

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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const supabase = createAdminClient();
  const results: Array<{ customerId: string; status: string; detail: any }> = [];

  try {
    // Get all active Bol.com customers
    const { data: customers, error: custError } = await supabase
      .from('bol_customers')
      .select('*')
      .eq('active', true);

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
  const detail: Record<string, string> = {};

  // ── Step 1: Get EANs from listings snapshot ──────────────────────────
  const { data: rawSnapshots } = await supabase
    .from('bol_raw_snapshots')
    .select('raw_data')
    .eq('bol_customer_id', customer.id)
    .eq('data_type', 'listings')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single();

  if (!rawSnapshots?.raw_data?.offers || !Array.isArray(rawSnapshots.raw_data.offers)) {
    detail.categories = 'No listings data available yet';
    return detail;
  }

  const offers = rawSnapshots.raw_data.offers as Array<{ ean?: string; EAN?: string }>;
  const eans = [...new Set(offers.map(o => o.ean || o.EAN).filter(Boolean))].slice(0, 50);

  if (eans.length === 0) {
    detail.categories = 'No EANs found in listings';
    return detail;
  }

  console.log(`[processCustomer] Found ${eans.length} unique EANs for customer ${customer.id}`);

  // ── Step 2: Fetch catalog data for each EAN ──────────────────────────
  const categoryInserts = [];
  let catalogFetched = 0;

  for (const ean of eans) {
    try {
      const catalog = await getCatalogProduct(token, ean);
      if (!catalog) {
        console.log(`[processCustomer] No catalog data for EAN ${ean}`);
        continue;
      }

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

      catalogFetched++;

      // Rate limit: 150ms between calls
      if (catalogFetched < eans.length) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (err) {
      console.error(`[processCustomer] Failed to fetch catalog for EAN ${ean}:`, err);
      // Continue with next EAN
    }
  }

  console.log(`[processCustomer] Fetched catalog for ${catalogFetched}/${eans.length} EANs`);

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

  // ── Get competitor EANs from existing snapshots ───────────────────────
  const yourEansArray = Array.from(yourEans);

  // Get competitor snapshots for YOUR products in this category
  const { data: competitorSnaps } = await supabase
    .from('bol_competitor_snapshots')
    .select('ean, competitor_prices')
    .eq('bol_customer_id', customerId)
    .in('ean', yourEansArray);

  if (!competitorSnaps || competitorSnaps.length === 0) {
    return 'No competitor snapshots found for products in this category';
  }

  // Aggregate competitor EANs and rank by frequency
  const competitorFrequency = new Map<string, {
    ean: string;
    frequency: number;
    prices: number[];
  }>();

  for (const snap of competitorSnaps) {
    const competitorPrices = snap.competitor_prices || [];

    for (const offer of competitorPrices) {
      const competitorEan = offer.ean || offer.EAN;
      if (!competitorEan || yourEans.has(competitorEan)) continue; // Skip if it's your own product

      const existing = competitorFrequency.get(competitorEan) || {
        ean: competitorEan,
        frequency: 0,
        prices: []
      };

      existing.frequency++;
      if (offer.price) existing.prices.push(offer.price);

      competitorFrequency.set(competitorEan, existing);
    }
  }

  // Rank by frequency and take top 100
  const rankedCompetitors = Array.from(competitorFrequency.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 100)
    .map((c, idx) => ({
      ean: c.ean,
      frequency: c.frequency,
      rank: idx + 1,
      avgPrice: c.prices.length > 0 ? c.prices.reduce((sum, p) => sum + p, 0) / c.prices.length : null
    }));

  if (rankedCompetitors.length === 0) {
    return 'No competitors found in snapshots';
  }

  // ── Fetch full catalog data for top 100 competitors ───────────────────
  const catalogInserts = [];
  const top100 = rankedCompetitors;

  let enriched = 0;
  for (const comp of top100) {
    try {
      const catalog = await getCatalogProduct(token, comp.ean);
      if (catalog) {
        const catalogData = catalog as any;

        catalogInserts.push({
          bol_customer_id: customerId,
          category_slug: category.categorySlug,
          competitor_ean: comp.ean,
          title: catalogData.title || catalogData.name || null,
          description: catalogData.description || null,
          brand: catalogData.brand || null,
          price: comp.avgPrice,
          buy_box_winner: false, // Will be determined from snapshots
          frequency_rank: comp.rank,
          category_path: category.categoryPath,
          attributes: catalogData.attributes || null,
          fetched_at: new Date().toISOString()
        });

        enriched++;
      }
    } catch (_) {
      // Skip individual failures
    }
    await sleep(150); // Rate limit
  }

  // Insert catalog data
  if (catalogInserts.length > 0) {
    await supabase.from('bol_competitor_catalog').insert(catalogInserts);
  }

  // ── Run AI content analysis ───────────────────────────────────────────
  const productsToAnalyze = catalogInserts.map(c => ({
    competitor_ean: c.competitor_ean,
    title: c.title,
    description: c.description,
    brand: c.brand,
    list_price: c.price,
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
