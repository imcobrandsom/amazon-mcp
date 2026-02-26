/**
 * GET /api/bol-analyses?customerId=<uuid>
 * Returns the latest analyses for a given bol customer.
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
  const { data, error } = await supabase
    .from('bol_analyses')
    .select('*')
    .eq('bol_customer_id', customerId)
    .order('analyzed_at', { ascending: false })
    .limit(20); // last 20 analyses (covers ~5 per category × 4 categories)

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ analyses: data ?? [] });
}
