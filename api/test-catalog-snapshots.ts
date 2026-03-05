/**
 * Debug endpoint: check catalog snapshots in database
 * GET /api/test-catalog-snapshots
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // Check if catalog_attributes column exists
    const { data: snapshots, error } = await supabase
      .from('bol_raw_snapshots')
      .select('id, bol_customer_id, data_type, fetched_at, catalog_attributes, raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog')
      .order('fetched_at', { ascending: false })
      .limit(3);

    if (error) {
      return res.status(500).json({
        error: error.message,
        hint: 'catalog_attributes column might not exist yet - run migration first',
      });
    }

    const samples = (snapshots ?? []).map(snap => {
      const rawData = snap.raw_data as Record<string, unknown>;
      return {
        id: snap.id,
        fetched_at: snap.fetched_at,
        ean: rawData.ean,
        has_catalog_attributes: snap.catalog_attributes !== null,
        catalog_attributes_keys: snap.catalog_attributes ? Object.keys(snap.catalog_attributes as Record<string, unknown>) : null,
        sample_description: snap.catalog_attributes ? (snap.catalog_attributes as Record<string, unknown>).Description : null,
      };
    });

    return res.status(200).json({
      total_catalog_snapshots: snapshots?.length ?? 0,
      samples,
    });

  } catch (err) {
    console.error('[test-catalog-snapshots] Fatal error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
