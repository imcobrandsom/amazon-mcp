/**
 * Test endpoint to debug extended sync query
 * GET /api/test-extended-query?customerId=XXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const customerId = req.query.customerId as string;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }

    const supabase = createAdminClient();

    // This is the EXACT query from bol-sync-extended.ts lines 67-74
    const { data: latestSnap, error } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return res.status(500).json({
        error: 'Query failed',
        detail: error.message,
        code: error.code,
      });
    }

    const offers: Record<string, string>[] =
      (latestSnap?.raw_data as { offers?: Record<string, string>[] })?.offers ?? [];

    return res.status(200).json({
      status: 'ok',
      has_snapshot: !!latestSnap,
      has_raw_data: !!latestSnap?.raw_data,
      has_offers_key: !!(latestSnap?.raw_data as any)?.offers,
      offers_count: offers.length,
      first_offer: offers[0] || null,
      raw_data_keys: latestSnap?.raw_data ? Object.keys(latestSnap.raw_data) : [],
    });
  } catch (err) {
    console.error('[test-extended-query] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
