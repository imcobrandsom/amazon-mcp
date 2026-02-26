/**
 * GET /api/bol-keywords?customerId=<uuid>
 * Returns keyword ranking data per EAN for a given bol customer.
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

  // Fetch last 8 weeks of rankings
  const eightWeeksAgo = new Date(Date.now() - 56 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('bol_keyword_rankings')
    .select('*')
    .eq('bol_customer_id', customerId)
    .gte('week_of', eightWeeksAgo)
    .order('week_of', { ascending: false })
    .limit(2000);

  if (error) return res.status(500).json({ error: error.message });

  const rows = data ?? [];

  // Group by (ean, search_type), compute current rank, previous rank, trend
  const grouped = new Map<
    string,
    {
      ean: string;
      search_type: string;
      current_rank: number | null;
      prev_rank: number | null;
      current_impressions: number | null;
      trend: 'up' | 'down' | 'stable' | 'new';
    }
  >();

  for (const row of rows) {
    const key = `${row.ean}|${row.search_type}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ean:                  row.ean as string,
        search_type:          row.search_type as string,
        current_rank:         null,
        prev_rank:            null,
        current_impressions:  null,
        trend:                'new',
      });
    }
    const entry = grouped.get(key)!;
    if (entry.current_rank === null) {
      entry.current_rank        = row.rank as number | null;
      entry.current_impressions = row.impressions as number | null;
    } else if (entry.prev_rank === null) {
      entry.prev_rank = row.rank as number | null;
    }
  }

  // Compute trends (lower rank number = better position)
  const rankings = Array.from(grouped.values()).map(entry => {
    let trend: 'up' | 'down' | 'stable' | 'new' = 'new';
    if (entry.prev_rank !== null && entry.current_rank !== null) {
      if (entry.current_rank < entry.prev_rank) trend = 'up';   // improved
      else if (entry.current_rank > entry.prev_rank) trend = 'down'; // worse
      else trend = 'stable';
    }
    return { ...entry, trend };
  });

  // Sort: SEARCH type first, then by rank asc, unranked (null) at bottom
  rankings.sort((a, b) => {
    if (a.search_type !== b.search_type) return a.search_type === 'SEARCH' ? -1 : 1;
    if (a.current_rank === null && b.current_rank === null) return 0;
    if (a.current_rank === null) return 1;
    if (b.current_rank === null) return -1;
    return a.current_rank - b.current_rank;
  });

  return res.status(200).json({ rankings, count: rankings.length });
}
