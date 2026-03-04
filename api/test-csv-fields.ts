/**
 * Debug endpoint: toon CSV offers velden (listings export)
 * GET /api/test-csv-fields
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // Haal de nieuwste listings snapshot op met CSV offers
    const { data: allSnapshots } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data, fetched_at, id')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(10);

    if (!allSnapshots || allSnapshots.length === 0) {
      return res.status(404).json({ error: 'No listings data found' });
    }

    // Find the newest snapshot with 'offers' array (CSV export format)
    const csvSnapshot = allSnapshots.find(
      snap => Array.isArray((snap.raw_data as Record<string, unknown>)?.offers)
    );

    if (!csvSnapshot) {
      return res.status(404).json({ error: 'No CSV offers snapshot found' });
    }

    const rawData = csvSnapshot.raw_data as Record<string, unknown>;
    const offers = (rawData.offers as Record<string, unknown>[] | undefined) ?? [];

    if (offers.length === 0) {
      return res.status(404).json({ error: 'CSV snapshot has no offers' });
    }

    // Toon eerste 3 offers met alle veldnamen
    const sampleOffers = offers.slice(0, 3).map(offer => ({
      available_fields: Object.keys(offer),
      has_description: 'description' in offer || 'Description' in offer || 'productDescription' in offer,
      sample_data: offer,
    }));

    return res.status(200).json({
      fetched_at: csvSnapshot.fetched_at,
      total_offers: offers.length,
      all_field_names: Object.keys(offers[0]),
      sample_offers: sampleOffers,
    });

  } catch (err) {
    console.error('[test-csv-fields] Fatal error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
