/**
 * Get competitor product catalog for a specific category
 *
 * GET /api/bol-competitor-catalog?customerId={uuid}&categorySlug={slug}&limit={number}
 *
 * Returns latest snapshot of competitor products with content analysis
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = req.query.customerId as string;
  const categorySlug = req.query.categorySlug as string;
  const limit = parseInt((req.query.limit as string) || '100', 10);

  if (!customerId || !categorySlug) {
    return res.status(400).json({
      error: 'customerId and categorySlug query parameters are required',
    });
  }

  const supabase = createAdminClient();

  try {
    // Fetch latest competitor catalog entries for this category
    const { data: rawCompetitors, error: catalogError } = await supabase
      .from('bol_competitor_catalog')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('category_slug', categorySlug)
      .order('fetched_at', { ascending: false })
      .limit(limit * 2); // Fetch extra to account for duplicates

    if (catalogError) {
      return res.status(500).json({ error: catalogError.message });
    }

    if (!rawCompetitors || rawCompetitors.length === 0) {
      return res.status(200).json({ competitors: [], count: 0 });
    }

    // Deduplicate by competitor_ean (keep latest entry for each EAN)
    const seen = new Set<string>();
    const competitors = [];

    for (const comp of rawCompetitors) {
      if (seen.has(comp.competitor_ean)) continue;
      seen.add(comp.competitor_ean);
      competitors.push(comp);

      if (competitors.length >= limit) break;
    }

    // Fetch content analysis for these competitors
    const eans = competitors.map((c) => c.competitor_ean);

    const { data: analyses, error: analysisError } = await supabase
      .from('bol_competitor_content_analysis')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('category_slug', categorySlug)
      .in('competitor_ean', eans)
      .order('analyzed_at', { ascending: false });

    if (analysisError) {
      console.error('Error fetching analyses:', analysisError);
      // Continue without analysis data
    }

    // Create map for fast lookup (latest analysis per EAN)
    const analysisMap = new Map();
    (analyses || []).forEach((a) => {
      if (!analysisMap.has(a.competitor_ean)) {
        analysisMap.set(a.competitor_ean, a);
      }
    });

    // Merge competitor data with analysis
    const enrichedCompetitors = competitors.map((c) => ({
      ...c,
      analysis: analysisMap.get(c.competitor_ean) || null,
    }));

    return res.status(200).json({
      competitors: enrichedCompetitors,
      count: enrichedCompetitors.length,
    });
  } catch (err) {
    console.error('Error fetching competitor catalog:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
