/**
 * POST /api/bol-keywords-fallback
 * Adds fallback keywords for products WITHOUT advertising keywords
 *
 * Strategy:
 * 1. Category-based keywords (from category_slug)
 * 2. Competitor keywords (if available from bol_competitor_catalog)
 * 3. Generic brand + product type keywords
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

// Default keyword sets per category
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  try {
    // 1. Find products WITHOUT any keywords
    const { data: productsWithoutKeywords } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (!productsWithoutKeywords) {
      return res.status(404).json({ error: 'No inventory data found' });
    }

    const inventory = ((productsWithoutKeywords.raw_data as any)?.inventory || []) as Array<{
      ean?: string;
      title?: string;
    }>;

    // Get products that already have keywords
    const { data: existingKeywords } = await supabase
      .from('bol_product_keyword_targets')
      .select('ean')
      .eq('bol_customer_id', customerId);

    const eansWithKeywords = new Set((existingKeywords || []).map(k => k.ean));
    const productsNeedingKeywords = inventory.filter(p => p.ean && !eansWithKeywords.has(p.ean));

    console.log(`Found ${productsNeedingKeywords.length} products without keywords`);

    // 2. Get category mapping
    const { data: categories } = await supabase
      .from('bol_product_categories')
      .select('ean, category_slug')
      .eq('bol_customer_id', customerId);

    const eanToCategory = new Map((categories || []).map(c => [c.ean, c.category_slug]));

    // 3. Get competitor keywords (if available)
    const { data: competitorKeywords } = await supabase
      .from('bol_competitor_catalog')
      .select('category_slug, title')
      .eq('bol_customer_id', customerId)
      .limit(100);

    const categoryCompetitorKeywords = new Map<string, Set<string>>();
    for (const comp of competitorKeywords || []) {
      if (!comp.title || !comp.category_slug) continue;

      if (!categoryCompetitorKeywords.has(comp.category_slug)) {
        categoryCompetitorKeywords.set(comp.category_slug, new Set());
      }

      // Extract potential keywords from competitor titles (simple word extraction)
      const words = comp.title.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 4 && !['dames', 'heren', 'voor', 'met', 'zwart', 'wit'].includes(w));

      words.forEach(w => categoryCompetitorKeywords.get(comp.category_slug)!.add(w));
    }

    // 4. Add fallback keywords per product
    const keywordsToInsert: Array<{
      bol_customer_id: string;
      ean: string;
      keyword: string;
      priority: number;
      source: string;
    }> = [];

    for (const product of productsNeedingKeywords.slice(0, 100)) { // Limit to 100 per run
      if (!product.ean) continue;

      const categorySlug = eanToCategory.get(product.ean);

      // Strategy 1: Category keywords
      if (categorySlug && CATEGORY_KEYWORDS[categorySlug]) {
        for (const { keyword, priority } of CATEGORY_KEYWORDS[categorySlug]) {
          keywordsToInsert.push({
            bol_customer_id: customerId,
            ean: product.ean,
            keyword,
            priority,
            source: 'category_analysis',
          });
        }
      }

      // Strategy 2: Generic sportkleding keywords (fallback)
      if (!categorySlug || !CATEGORY_KEYWORDS[categorySlug]) {
        for (const { keyword, priority } of CATEGORY_KEYWORDS['sportkleding']) {
          keywordsToInsert.push({
            bol_customer_id: customerId,
            ean: product.ean,
            keyword,
            priority: Math.max(3, priority - 3), // Lower priority for generic
            source: 'category_analysis',
          });
        }
      }

      // Strategy 3: Competitor keywords (if available)
      if (categorySlug && categoryCompetitorKeywords.has(categorySlug)) {
        const compKeywords = Array.from(categoryCompetitorKeywords.get(categorySlug)!);
        for (const kw of compKeywords.slice(0, 5)) { // Top 5 competitor keywords
          keywordsToInsert.push({
            bol_customer_id: customerId,
            ean: product.ean,
            keyword: kw,
            priority: 5,
            source: 'competitor_intel',
          });
        }
      }
    }

    // 5. Bulk insert (ignore duplicates)
    let inserted = 0;
    if (keywordsToInsert.length > 0) {
      for (const kw of keywordsToInsert) {
        const { error } = await supabase
          .from('bol_product_keyword_targets')
          .insert(kw)
          .select('id')
          .maybeSingle();

        if (!error) inserted++;
      }
    }

    return res.status(200).json({
      message: 'Fallback keywords added',
      products_processed: productsNeedingKeywords.slice(0, 100).length,
      keywords_added: inserted,
      products_still_without_keywords: Math.max(0, productsNeedingKeywords.length - 100),
    });
  } catch (error) {
    console.error('Fallback keywords error:', error);
    return res.status(500).json({
      error: 'Failed to add fallback keywords',
      details: (error as Error).message,
    });
  }
}
