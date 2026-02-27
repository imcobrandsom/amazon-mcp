/**
 * GET /api/bol-campaigns-chart?customerId=<uuid>&days=30
 * Returns daily-aggregated advertising metrics for the given date range.
 * Unlike /api/bol-campaigns (which deduplicates), this returns ALL rows so
 * we can build a time-series chart.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { customerId, days } = req.query;
  if (!customerId || typeof customerId !== 'string')
    return res.status(400).json({ error: 'customerId required' });

  const numDays = Math.min(parseInt(String(days ?? '30'), 10) || 30, 90);
  const since = new Date(Date.now() - numDays * 86_400_000).toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bol_campaign_performance')
    .select('synced_at, spend, revenue, impressions, clicks, conversions')
    .eq('bol_customer_id', customerId)
    .gte('synced_at', since)
    .order('synced_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Fetch orders data for TACOS calculation (total revenue from all sources)
  const { data: ordersData } = await supabase
    .from('bol_raw_snapshots')
    .select('raw_data, fetched_at')
    .eq('bol_customer_id', customerId)
    .eq('data_type', 'orders')
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: true });

  // Build map of date → total revenue from orders
  const orderRevenueByDate = new Map<string, number>();
  for (const snap of ordersData ?? []) {
    const date = (snap.fetched_at as string).slice(0, 10);
    const orders = ((snap.raw_data as Record<string, unknown>)?.orders as Array<Record<string, unknown>>) ?? [];
    const totalRevenue = orders.reduce((sum, order) => {
      const orderItems = (order.orderItems as Array<{ quantity?: number; unitPrice?: number }>) ?? [];
      const amount = orderItems.reduce(
        (s, item) => s + ((item.quantity ?? 0) * (item.unitPrice ?? 0)),
        0
      );
      return sum + amount;
    }, 0);
    orderRevenueByDate.set(date, (orderRevenueByDate.get(date) ?? 0) + totalRevenue);
  }

  // Aggregate by date string (YYYY-MM-DD) — sum across all campaigns per day
  const byDate = new Map<string, {
    spend: number; revenue: number; impressions: number; clicks: number; conversions: number;
  }>();

  for (const row of data ?? []) {
    const date = (row.synced_at as string).slice(0, 10);
    const prev = byDate.get(date) ?? { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 };
    byDate.set(date, {
      spend:       prev.spend       + (row.spend       ?? 0),
      revenue:     prev.revenue     + (row.revenue     ?? 0),
      impressions: prev.impressions + (row.impressions ?? 0),
      clicks:      prev.clicks      + (row.clicks      ?? 0),
      conversions: prev.conversions + (row.conversions ?? 0),
    });
  }

  const points = [...byDate.entries()].map(([date, v]) => {
    const totalRevenue = orderRevenueByDate.get(date) ?? v.revenue; // Fallback to ad revenue if orders not available
    return {
      date,
      spend:       v.spend,
      revenue:     v.revenue,
      impressions: v.impressions,
      clicks:      v.clicks,
      conversions: v.conversions,
      roas:    v.spend > 0 ? Math.round((v.revenue / v.spend) * 100) / 100 : 0,
      acos:    v.revenue > 0 ? Math.round((v.spend / v.revenue) * 10000) / 100 : 0,
      tacos:   totalRevenue > 0 ? Math.round((v.spend / totalRevenue) * 10000) / 100 : 0,
      ctr_pct: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10_000) / 100 : 0,
    };
  });

  return res.status(200).json({ points });
}
