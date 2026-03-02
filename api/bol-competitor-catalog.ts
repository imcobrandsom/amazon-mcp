/**
 * Get competitor product catalog for a specific category
 *
 * GET /api/bol-competitor-catalog?customerId={uuid}&categorySlug={slug}&limit={number}
 *
 * Returns latest snapshot of competitor products with content analysis
 */

import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get('customerId');
  const categorySlug = url.searchParams.get('categorySlug');
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);

  if (!customerId || !categorySlug) {
    return new Response(
      JSON.stringify({
        error: 'customerId and categorySlug query parameters are required',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const supabase = createAdminClient();

  try {
    // Fetch latest competitor catalog entries for this category
    const { data: rawCompetitors, error: catalogError } = await supabase
      .from('bol_competitor_catalog')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('category_slug', categorySlug)
      .eq('is_customer_product', false) // Only competitors, not your products
      .order('fetched_at', { ascending: false })
      .limit(limit * 2); // Fetch extra to account for duplicates

    if (catalogError) {
      return new Response(JSON.stringify({ error: catalogError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!rawCompetitors || rawCompetitors.length === 0) {
      return new Response(
        JSON.stringify({ competitors: [], count: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
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
    const eans = competitors.map(c => c.competitor_ean);

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
    (analyses || []).forEach(a => {
      if (!analysisMap.has(a.competitor_ean)) {
        analysisMap.set(a.competitor_ean, a);
      }
    });

    // Merge competitor data with analysis
    const enrichedCompetitors = competitors.map(c => ({
      ...c,
      analysis: analysisMap.get(c.competitor_ean) || null,
    }));

    return new Response(
      JSON.stringify({
        competitors: enrichedCompetitors,
        count: enrichedCompetitors.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Error fetching competitor catalog:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
