/**
 * Get category-level competitive insights for a Bol.com customer
 *
 * GET /api/bol-category-insights?customerId={uuid}&categorySlug={slug}
 *
 * If categorySlug is provided, returns single object for that category
 * If omitted, returns array of all categories for the customer
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = req.query.customerId as string;
  const categorySlug = req.query.categorySlug as string | undefined;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId query parameter is required' });
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
        return res.status(500).json({ error: error.message });
      }

      // Return single object or null
      return res.status(200).json({ insights: data && data.length > 0 ? data[0] : null });
    } else {
      // Get latest insights for all categories
      // Deduplicate by category_slug (keep only latest per category)
      const { data: allData, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Deduplicate: keep only the latest insight per category_slug
      const seenSlugs = new Set<string>();
      const deduped = (allData || []).filter((insight) => {
        if (seenSlugs.has(insight.category_slug)) return false;
        seenSlugs.add(insight.category_slug);
        return true;
      });

      return res.status(200).json({ insights: deduped });
    }
  } catch (err) {
    console.error('Error fetching category insights:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
