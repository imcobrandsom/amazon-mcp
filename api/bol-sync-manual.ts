/**
 * POST /api/bol-sync-manual
 * Manual full-sync trigger for a single bol customer — for testing and on-demand use.
 *
 * Body: { "customerId": "<uuid>" }
 * Header: x-webhook-secret: <BOL_WEBHOOK_SECRET>
 *
 * Returns a detailed sync report so you can verify everything is working.
 * Inventory + orders are processed synchronously.
 * The offers export job is submitted and its ID returned — it will be
 * picked up automatically by bol-sync-complete within 5 minutes.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient }   from './_lib/supabase-admin.js';
import {
  getBolToken,
  getAdsToken,
  startOffersExport,
  getInventory,
  getOrders,
  getAdsCampaigns,
  getAdsAdGroups,
  getAdsPerformance,
  getReturns,
  getPerformanceIndicator,
  sleep,
} from './_lib/bol-api-client.js';
import {
  analyzeInventory,
  analyzeOrders,
  analyzeAdvertising,
  analyzeReturns,
  analyzePerformance,
} from './_lib/bol-analysis.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.BOL_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorised — provide x-webhook-secret header' });
  }

  const { customerId } = req.body ?? {};
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });

  const supabase = createAdminClient();
  const startedAt = Date.now();

  const { data: customer, error: customerErr } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret, ads_client_id, ads_client_secret, active')
    .eq('id', customerId)
    .single();

  if (customerErr || !customer) return res.status(404).json({ error: 'Customer not found' });
  if (!customer.active) return res.status(400).json({ error: 'Customer is inactive' });

  let token: string;
  try {
    token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);
  } catch (e) {
    return res.status(400).json({ error: `Bol.com auth failed: ${(e as Error).message}` });
  }

  const report: Record<string, unknown> = {
    customer_id:   customer.id,
    seller_name:   customer.seller_name,
    started_at:    new Date().toISOString(),
  };

  // ── Offers export (async — submit job, will complete in ~1-5 min) ──────────
  try {
    const processStatusId = await startOffersExport(token);
    await supabase.from('bol_sync_jobs').insert({
      bol_customer_id:   customer.id,
      data_type:         'listings',
      process_status_id: processStatusId,
      status:            'pending',
    });
    report.offers_export = { status: 'job_submitted', process_status_id: processStatusId, note: 'Will complete in ~1-5 min via bol-sync-complete cron' };
  } catch (e) {
    report.offers_export = { status: 'failed', error: (e as Error).message };
  }

  // ── Inventory (synchronous) ───────────────────────────────────────────────
  try {
    const inventory = await getInventory(token);
    const analysis  = analyzeInventory(inventory);

    const { data: snap } = await supabase.from('bol_raw_snapshots').insert({
      bol_customer_id: customer.id,
      data_type:       'inventory',
      raw_data:        { items: inventory },
      record_count:    inventory.length,
      quality_score:   inventory.length > 0 ? 1.0 : 0.5,
    }).select('id').single();

    await supabase.from('bol_analyses').insert({
      bol_customer_id: customer.id,
      snapshot_id:     snap?.id ?? null,
      category:        'inventory',
      score:           analysis.score,
      findings:        analysis.findings,
      recommendations: analysis.recommendations,
    });

    report.inventory = { status: 'ok', items: inventory.length, score: analysis.score };
  } catch (e) {
    report.inventory = { status: 'failed', error: (e as Error).message };
  }

  // ── Orders (synchronous) ──────────────────────────────────────────────────
  try {
    const orders   = await getOrders(token);
    const analysis = analyzeOrders(orders);

    const { data: snap } = await supabase.from('bol_raw_snapshots').insert({
      bol_customer_id: customer.id,
      data_type:       'orders',
      raw_data:        { orders },
      record_count:    orders.length,
      quality_score:   1.0,
    }).select('id').single();

    await supabase.from('bol_analyses').insert({
      bol_customer_id: customer.id,
      snapshot_id:     snap?.id ?? null,
      category:        'orders',
      score:           analysis.score,
      findings:        analysis.findings,
      recommendations: analysis.recommendations,
    });

    report.orders = { status: 'ok', count: orders.length, score: analysis.score };
  } catch (e) {
    report.orders = { status: 'failed', error: (e as Error).message };
  }

  // ── Advertising (if ads credentials exist) ────────────────────────────────
  const adsClientId     = customer.ads_client_id as string | null;
  const adsClientSecret = customer.ads_client_secret as string | null;

  if (adsClientId && adsClientSecret) {
    try {
      const adsToken  = await getAdsToken(adsClientId, adsClientSecret);
      const campaigns = await getAdsCampaigns(adsToken);

      const allAdGroups: unknown[] = [];
      for (const campaign of (campaigns as Array<{ campaignId?: string }>).slice(0, 20)) {
        if (campaign.campaignId) {
          const groups = await getAdsAdGroups(adsToken, campaign.campaignId);
          allAdGroups.push(...groups);
          await sleep(100);
        }
      }

      const now      = new Date();
      const dateTo   = now.toISOString().slice(0, 10);
      const dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const perf     = await getAdsPerformance(adsToken, dateFrom, dateTo);

      const analysis = analyzeAdvertising(campaigns, allAdGroups, perf);

      const { data: snap } = await supabase.from('bol_raw_snapshots').insert({
        bol_customer_id: customer.id,
        data_type:       'advertising',
        raw_data:        { campaigns, adGroups: allAdGroups, performance: perf },
        record_count:    campaigns.length,
        quality_score:   1.0,
      }).select('id').single();

      await supabase.from('bol_analyses').insert({
        bol_customer_id: customer.id,
        snapshot_id:     snap?.id ?? null,
        category:        'advertising',
        score:           analysis.score,
        findings:        analysis.findings,
        recommendations: analysis.recommendations,
      });

      report.advertising = { status: 'ok', campaigns: campaigns.length, score: analysis.score, findings: analysis.findings };
    } catch (e) {
      report.advertising = { status: 'failed', error: (e as Error).message };
    }
  } else {
    report.advertising = { status: 'skipped', note: 'No ads credentials configured' };
  }

  // ── Returns ───────────────────────────────────────────────────────────────
  try {
    const [openRets, handledRets] = await Promise.all([
      getReturns(token, false),
      getReturns(token, true),
    ]);
    const analysis = analyzeReturns(openRets, handledRets);

    await supabase.from('bol_analyses').insert({
      bol_customer_id: customer.id,
      snapshot_id:     null,
      category:        'returns',
      score:           analysis.score,
      findings:        analysis.findings,
      recommendations: analysis.recommendations,
    });

    report.returns = { status: 'ok', open: openRets.length, handled: handledRets.length, score: analysis.score };
  } catch (e) {
    report.returns = { status: 'failed', error: (e as Error).message };
  }

  // ── Performance indicators ────────────────────────────────────────────────
  try {
    const indicatorNames = ['CANCELLATION_RATE', 'FULFILMENT_RATE', 'REVIEW_SCORE'] as const;
    const rawIndicators = await Promise.all(
      indicatorNames.map(name => getPerformanceIndicator(token, name))
    );
    const indicators = rawIndicators.filter(Boolean) as NonNullable<typeof rawIndicators[0]>[];

    if (indicators.length > 0) {
      const analysis = analyzePerformance(indicators);
      await supabase.from('bol_analyses').insert({
        bol_customer_id: customer.id,
        snapshot_id:     null,
        category:        'performance',
        score:           analysis.score,
        findings:        analysis.findings,
        recommendations: analysis.recommendations,
      });
      report.performance = { status: 'ok', indicators: indicators.length, score: analysis.score };
    } else {
      report.performance = { status: 'no_data', note: 'No performance indicators returned' };
    }
  } catch (e) {
    report.performance = { status: 'failed', error: (e as Error).message };
  }

  // Update last_sync_at
  await supabase.from('bol_customers').update({ last_sync_at: new Date().toISOString() }).eq('id', customer.id);

  report.duration_ms = Date.now() - startedAt;
  return res.status(200).json(report);
}
