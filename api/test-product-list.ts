/**
 * Debug endpoint: toon eerste 3 listings offers met alle veldnamen
 * GET /api/test-product-list
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // Haal alle listings snapshots op
    const { data: allSnapshots } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data, fetched_at, id')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(5);

    if (!allSnapshots || allSnapshots.length === 0) {
      return res.status(404).json({ error: 'No listings data found' });
    }

    const results = allSnapshots.map(snap => {
      const rawData = snap.raw_data as Record<string, unknown>;
      const topLevelKeys = Object.keys(rawData);
      const offers = (rawData.offers as Record<string, unknown>[] | undefined) ?? [];
      const catalog = rawData.catalog as Record<string, unknown> | undefined;

      return {
        id: snap.id,
        fetched_at: snap.fetched_at,
        structure_type: offers.length > 0 ? 'CSV_OFFERS' : catalog ? 'CATALOG_API' : 'UNKNOWN',
        top_level_keys: topLevelKeys,
        offers_count: offers.length,
        catalog_eans: catalog ? Object.keys(catalog).length : 0,
        sample_offer_fields: offers[0] ? Object.keys(offers[0]) : [],
      };
    });

    return res.status(200).json({
      total_snapshots: results.length,
      snapshots: results,
    });

  } catch (err) {
    console.error('[test-product-list] Fatal error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
