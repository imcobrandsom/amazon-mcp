/**
 * GET /api/bol-competitors?customerId=<uuid>
 * Returns the latest competitor snapshot per EAN for a given bol customer.
 * Populated by the bol-sync-extended cron (runs every 6h).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { customerId } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId query param required' });
  }

  const supabase = createAdminClient();

  // Fetch recent snapshots ordered by fetched_at desc (limit 1000)
  const { data, error } = await supabase
    .from('bol_competitor_snapshots')
    .select('*')
    .eq('bol_customer_id', customerId)
    .order('fetched_at', { ascending: false })
    .limit(1000);

  if (error) return res.status(500).json({ error: error.message });

  // Deduplicate: keep latest snapshot per EAN
  const seenEans = new Set<string>();
  const latest = (data ?? []).filter(row => {
    if (seenEans.has(row.ean as string)) return false;
    seenEans.add(row.ean as string);
    return true;
  });

  return res.status(200).json({ competitors: latest, count: latest.length });
}
