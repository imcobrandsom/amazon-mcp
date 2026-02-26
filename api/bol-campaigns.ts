/**
 * GET /api/bol-campaigns?customerId=<uuid>
 * Returns the latest campaign + keyword performance rows from the time-series tables,
 * deduplicated to one row per campaign_id / keyword_id (most recent synced_at wins).
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

  const [campResult, kwResult] = await Promise.all([
    supabase
      .from('bol_campaign_performance')
      .select('*')
      .eq('bol_customer_id', customerId)
      .order('synced_at', { ascending: false })
      .limit(500),
    supabase
      .from('bol_keyword_performance')
      .select('*')
      .eq('bol_customer_id', customerId)
      .order('synced_at', { ascending: false })
      .limit(2000),
  ]);

  if (campResult.error) return res.status(500).json({ error: campResult.error.message });
  if (kwResult.error)   return res.status(500).json({ error: kwResult.error.message });

  // Deduplicate: keep only the most recent row per campaign_id
  const seenCampaigns = new Set<string>();
  const campaigns = (campResult.data ?? []).filter(row => {
    if (seenCampaigns.has(row.campaign_id as string)) return false;
    seenCampaigns.add(row.campaign_id as string);
    return true;
  });

  // Deduplicate: keep only the most recent row per keyword_id
  const seenKeywords = new Set<string>();
  const keywords = (kwResult.data ?? []).filter(row => {
    if (seenKeywords.has(row.keyword_id as string)) return false;
    seenKeywords.add(row.keyword_id as string);
    return true;
  });

  return res.status(200).json({ campaigns, keywords, count: campaigns.length });
}
