/**
 * Debug endpoint: toon inventory data structuur
 * GET /api/test-inventory-fields
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const customerId = (req.query.customerId as string) || FASHIONPOWER_ID;
  const supabase = createAdminClient();

  try {
    // Haal de laatste inventory snapshot op
    const { data: snapshot } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data, fetched_at, id')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (!snapshot) {
      return res.status(404).json({ error: 'No inventory data found' });
    }

    const rawData = snapshot.raw_data as Record<string, unknown>;
    const items = (rawData.items as Record<string, unknown>[] | undefined) ?? [];

    // Toon eerste 3 items met alle velden
    const sampleItems = items.slice(0, 3).map(item => ({
      available_fields: Object.keys(item),
      sample_data: item,
    }));

    return res.status(200).json({
      fetched_at: snapshot.fetched_at,
      total_items: items.length,
      sample_items: sampleItems,
    });

  } catch (err) {
    console.error('[test-inventory-fields] Fatal error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
