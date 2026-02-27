/**
 * GET /api/bol-campaigns?customerId=<uuid>
 * GET /api/bol-campaigns?customerId=<uuid>&from=2025-01-01&to=2025-12-31
 * Returns campaign + keyword performance from the time-series tables.
 * Without date range: returns latest snapshot (deduplicated by most recent synced_at).
 * With date range: aggregates metrics (sum spend/clicks/etc) within the period.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { customerId, from, to } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId query param required' });
  }

  const supabase = createAdminClient();

  // Build queries with optional date range filter
  let campQuery = supabase
    .from('bol_campaign_performance')
    .select('*')
    .eq('bol_customer_id', customerId);

  let kwQuery = supabase
    .from('bol_keyword_performance')
    .select('*')
    .eq('bol_customer_id', customerId);

  if (from && to && typeof from === 'string' && typeof to === 'string') {
    // Filter by period dates (report date range), not synced_at
    campQuery = campQuery.gte('period_start_date', from).lte('period_end_date', to);
    kwQuery = kwQuery.gte('period_start_date', from).lte('period_end_date', to);
  }

  const [campResult, kwResult] = await Promise.all([
    campQuery.order('period_start_date', { ascending: false }).limit(5000),
    kwQuery.order('period_start_date', { ascending: false }).limit(10000),
  ]);

  if (campResult.error) return res.status(500).json({ error: campResult.error.message });
  if (kwResult.error)   return res.status(500).json({ error: kwResult.error.message });

  const hasDateRange = from && to;

  let campaigns, keywords;

  if (hasDateRange) {
    // Aggregate metrics within date range
    const campMap = new Map<string, any>();
    for (const row of campResult.data ?? []) {
      const key = row.campaign_id as string;
      if (!campMap.has(key)) {
        campMap.set(key, {
          ...row,
          spend: 0,
          revenue: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
        });
      }
      const agg = campMap.get(key);
      agg.spend += row.spend ?? 0;
      agg.revenue += row.revenue ?? 0;
      agg.impressions += row.impressions ?? 0;
      agg.clicks += row.clicks ?? 0;
      agg.conversions += row.conversions ?? 0;
      // Recalculate derived metrics
      agg.roas = agg.spend > 0 ? agg.revenue / agg.spend : 0;
      agg.acos = agg.revenue > 0 ? (agg.spend / agg.revenue) * 100 : 0;
      agg.ctr_pct = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
      agg.cvr_pct = agg.clicks > 0 ? (agg.conversions / agg.clicks) * 100 : 0;
      agg.avg_cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
    }
    campaigns = Array.from(campMap.values());

    const kwMap = new Map<string, any>();
    for (const row of kwResult.data ?? []) {
      const key = row.keyword_id as string;
      if (!kwMap.has(key)) {
        kwMap.set(key, {
          ...row,
          spend: 0,
          revenue: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
        });
      }
      const agg = kwMap.get(key);
      agg.spend += row.spend ?? 0;
      agg.revenue += row.revenue ?? 0;
      agg.impressions += row.impressions ?? 0;
      agg.clicks += row.clicks ?? 0;
      agg.conversions += row.conversions ?? 0;
      // Recalculate ACOS
      agg.acos = agg.revenue > 0 ? (agg.spend / agg.revenue) * 100 : 0;
    }
    keywords = Array.from(kwMap.values());
  } else {
    // Deduplicate: keep only the most recent row per campaign_id
    const seenCampaigns = new Set<string>();
    campaigns = (campResult.data ?? []).filter(row => {
      if (seenCampaigns.has(row.campaign_id as string)) return false;
      seenCampaigns.add(row.campaign_id as string);
      return true;
    });

    // Deduplicate: keep only the most recent row per keyword_id
    const seenKeywords = new Set<string>();
    keywords = (kwResult.data ?? []).filter(row => {
      if (seenKeywords.has(row.keyword_id as string)) return false;
      seenKeywords.add(row.keyword_id as string);
      return true;
    });
  }

  return res.status(200).json({ campaigns, keywords, count: campaigns.length });
}
