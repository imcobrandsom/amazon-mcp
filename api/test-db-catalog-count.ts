/**
 * Direct database query to count catalog snapshots
 * GET /api/test-db-catalog-count
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // Count catalog snapshots
    const { count, error } = await supabase
      .from('bol_raw_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get a few samples
    const { data: samples } = await supabase
      .from('bol_raw_snapshots')
      .select('id, fetched_at, catalog_attributes')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog')
      .order('fetched_at', { ascending: false })
      .limit(3);

    return res.status(200).json({
      total_count: count,
      samples: (samples ?? []).map(s => ({
        id: s.id,
        fetched_at: s.fetched_at,
        has_catalog_attributes: s.catalog_attributes !== null,
        description_length: s.catalog_attributes
          ? ((s.catalog_attributes as Record<string, unknown>).Description as string | undefined)?.length ?? 0
          : 0,
      })),
    });

  } catch (err) {
    console.error('[test-db-catalog-count] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
