/**
 * Get category-level competitive insights for a Bol.com customer
 *
 * GET /api/bol-category-insights?customerId={uuid}&categorySlug={slug}
 *
 * If categorySlug is provided, returns single object for that category
 * If omitted, returns array of all categories for the customer
 */

import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get('customerId');
  const categorySlug = url.searchParams.get('categorySlug');

  if (!customerId) {
    return new Response(
      JSON.stringify({ error: 'customerId query parameter is required' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const supabase = createAdminClient();

  try {
    let query = supabase
      .from('bol_category_insights')
      .select('*')
      .eq('bol_customer_id', customerId)
      .order('generated_at', { ascending: false });

    if (categorySlug) {
      // Get latest insights for specific category
      query = query.eq('category_slug', categorySlug).limit(1);
      const { data, error } = await query;

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Return single object or null
      return new Response(
        JSON.stringify({ insights: data && data.length > 0 ? data[0] : null }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      // Get latest insights for all categories
      // Deduplicate by category_slug (keep only latest per category)
      const { data: allData, error } = await query;

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Deduplicate: keep only the latest insight per category_slug
      const seenSlugs = new Set<string>();
      const deduped = (allData || []).filter(insight => {
        if (seenSlugs.has(insight.category_slug)) return false;
        seenSlugs.add(insight.category_slug);
        return true;
      });

      return new Response(JSON.stringify({ insights: deduped }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('Error fetching category insights:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
