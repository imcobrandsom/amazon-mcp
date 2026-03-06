/**
 * GET /api/bol-product-analysis?customerId=<uuid>&ean=<ean>
 * Returns detailed analysis for a single product: completeness, keywords, competitor intel
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { customerId, ean } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId query param required' });
  }
  if (!ean || typeof ean !== 'string') {
    return res.status(400).json({ error: 'ean query param required' });
  }

  const supabase = createAdminClient();

  // Parallel fetch: completeness + keywords + competitor + product data
  const [completenessRes, keywordsRes, competitorRes, productRes] = await Promise.all([
    // Completeness data via function
    supabase.rpc('get_product_completeness', {
      p_customer_id: customerId,
      p_ean: ean,
    }),

    // Target keywords
    supabase
      .from('bol_product_keyword_targets')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('ean', ean)
      .order('priority', { ascending: false }),

    // Competitor data (if exists)
    supabase
      .from('bol_competitor_snapshots')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('ean', ean)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single(),

    // Product catalog data
    supabase
      .from('bol_raw_snapshots')
      .select('catalog_attributes')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog')
      .eq('raw_data->>ean', ean)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (completenessRes.error) {
    console.error('Completeness query error:', completenessRes.error);
  }

  if (keywordsRes.error) {
    console.error('Keywords query error:', keywordsRes.error);
  }

  return res.status(200).json({
    completeness: completenessRes.data?.[0] ?? null,
    keywords: keywordsRes.data ?? [],
    competitor: competitorRes.data ?? null,
    product: {
      ean,
      title: (productRes.data?.catalog_attributes as any)?.Title ?? null,
      description: (productRes.data?.catalog_attributes as any)?.Description ?? null,
      catalogAttributes: productRes.data?.catalog_attributes ?? null,
    },
  });
}
