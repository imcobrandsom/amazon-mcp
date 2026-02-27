/**
 * Cron 1 — /api/bol-sync-start
 * Schedule: daily at 02:00 UTC (see vercel.json)
 *
 * For every active bol_customer this function:
 *  1. Submits an async offers-export job  → stores processStatusId in bol_sync_jobs
 *  2. Fetches inventory synchronously     → stores snapshot + runs analysis
 *  3. Fetches orders synchronously        → stores snapshot + runs analysis
 *  4. Fetches ad campaigns (if ads creds) → stores advertising analysis
 *  5. Fetches returns                     → stores returns analysis
 *  6. Fetches performance indicators      → stores performance analysis
 *
 * The offers export is picked up later by bol-sync-complete (runs every 5 min).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient }  from './_lib/supabase-admin.js';
import {
  getBolToken,
  getAdsToken,
  startOffersExport,
  getInventory,
  getOrders,
  getAdsCampaigns,
  getAdsAdGroups,
  getAdsPerformance,
  getAdsCampaignPerformance,
  getAdsKeywords,
  getAdsKeywordPerformance,
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

function isAuthorised(req: VercelRequest): boolean {
  const cronSecret    = process.env.CRON_SECRET;
  const webhookSecret = process.env.BOL_WEBHOOK_SECRET;
  const auth          = req.headers['authorization'] ?? '';
  const manual        = req.headers['x-webhook-secret'];
  return (cronSecret && auth === `Bearer ${cronSecret}`)
      || (webhookSecret && manual === webhookSecret)
      || false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = createAdminClient();
  const startedAt = Date.now();
  const results: Array<{ customerId: string; sellerName: string; status: string; detail: string }> = [];

  // Load all active customers (including ads credentials)
  const { data: customers, error: customersErr } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret, ads_client_id, ads_client_secret')
    .eq('active', true);

  if (customersErr) return res.status(500).json({ error: customersErr.message });
  if (!customers?.length) return res.status(200).json({ message: 'No active bol customers', results: [] });

  for (const customer of customers) {
    const ctx = { customerId: customer.id as string, sellerName: customer.seller_name as string };
    const detail: Record<string, string> = {};

    try {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      // ── 1. Submit async offers export ──────────────────────────────────────
      try {
        const processStatusId = await startOffersExport(token);
        await supabase.from('bol_sync_jobs').insert({
          bol_customer_id:   customer.id,
          data_type:         'listings',
          process_status_id: processStatusId,
          status:            'pending',
        });
        detail.offers = `job submitted (${processStatusId})`;
      } catch (e) {
        detail.offers = `FAILED: ${(e as Error).message}`;
      }

      // ── 2. Fetch inventory ─────────────────────────────────────────────────
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

        detail.inventory = `${inventory.length} items, score ${analysis.score}`;
      } catch (e) {
        detail.inventory = `FAILED: ${(e as Error).message}`;
      }

      // ── 3. Fetch orders ────────────────────────────────────────────────────
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

        detail.orders = `${orders.length} orders, score ${analysis.score}`;
      } catch (e) {
        detail.orders = `FAILED: ${(e as Error).message}`;
      }

      // ── 4. Advertising (if ads credentials exist) ──────────────────────────
      const adsClientId     = customer.ads_client_id as string | null;
      const adsClientSecret = customer.ads_client_secret as string | null;

      if (adsClientId && adsClientSecret) {
        try {
          const adsToken  = await getAdsToken(adsClientId, adsClientSecret);
          const campaigns = await getAdsCampaigns(adsToken);

          // Fetch last 2 days (incremental sync for async job)
          const now = new Date();
          const daysToFetch = 2;

          console.log(`[bol-sync-start] Fetching ${daysToFetch} days of advertising data...`);

          // Fetch ad groups per campaign (fetch once, reuse for all days)
          const allAdGroups: unknown[] = [];
          for (const campaign of (campaigns as Array<{ campaignId?: string }>).slice(0, 20)) {
            if (campaign.campaignId) {
              const groups = await getAdsAdGroups(adsToken, campaign.campaignId);
              allAdGroups.push(...groups);
              await sleep(100);
            }
          }

          // Fetch keywords once (reuse for all days)
          const allKeywords: Array<Record<string, unknown>> = [];
          for (const adGroup of (allAdGroups as Array<{ adGroupId?: string }>).slice(0, 40)) {
            if (adGroup.adGroupId) {
              const kws = await getAdsKeywords(adsToken, adGroup.adGroupId);
              allKeywords.push(...(kws as Array<Record<string, unknown>>));
              await sleep(100);
            }
          }

          const campaignIds = (campaigns as Array<{ campaignId?: string }>)
            .filter(c => c.campaignId).map(c => c.campaignId as string);
          const keywordIds = allKeywords.filter(k => k.keywordId).map(k => k.keywordId as string);

          // Collect all rows to bulk insert at the end
          const allCampRows: Array<Record<string, unknown>> = [];
          const allKwRows: Array<Record<string, unknown>> = [];

          // ── Fetch data day-by-day to build proper time-series ────────────────
          for (let dayOffset = daysToFetch - 1; dayOffset >= 0; dayOffset--) {
            const date = new Date(now.getTime() - dayOffset * 86400000).toISOString().slice(0, 10);
            console.log(`[bol-sync-start] Fetching data for ${date}...`);

            try {
              // Fetch campaign performance for this specific day
              const campPerfSubTotals = await getAdsCampaignPerformance(adsToken, campaignIds, date, date);
              const campSubTotals = campPerfSubTotals as Array<Record<string, unknown>>;

              // Create rows for each campaign
              for (const camp of campaigns as Array<Record<string, unknown>>) {
                const campaignId = camp.campaignId as string;
                const p = campSubTotals.find(s => s.entityId === campaignId)
                       ?? campSubTotals.find(s => s.campaignId === campaignId)
                       ?? {};
                const budget = camp.dailyBudget as Record<string, unknown> | undefined;

                allCampRows.push({
                  bol_customer_id:    customer.id,
                  campaign_id:        campaignId,
                  campaign_name:      (camp.name as string) ?? null,
                  campaign_type:      (camp.campaignType as string) ?? null,
                  state:              (camp.state as string) ?? null,
                  budget:             budget?.amount ?? null,
                  spend:              p.cost ?? null,
                  impressions:        p.impressions ?? null,
                  clicks:             p.clicks ?? null,
                  ctr_pct:            p.ctr ?? null,
                  avg_cpc:            p.averageCpc ?? null,
                  revenue:            p.sales14d ?? null,
                  roas:               p.roas14d ?? null,
                  acos:               p.acos14d ?? null,
                  conversions:        p.conversions14d ?? null,
                  cvr_pct:            p.conversionRate14d ?? null,
                  period_start_date:  date,  // Single day
                  period_end_date:    date,  // Single day
                });
              }

              // Fetch keyword performance for this specific day
              if (keywordIds.length > 0) {
                const kwPerfSubTotals = await getAdsKeywordPerformance(adsToken, keywordIds, date, date);
                const kwSubTotals = kwPerfSubTotals as Array<Record<string, unknown>>;

                for (const kw of allKeywords) {
                  const keywordId = kw.keywordId as string;
                  const p = kwSubTotals.find(s => s.entityId === keywordId)
                         ?? kwSubTotals.find(s => s.keywordId === keywordId)
                         ?? {};
                  const bid = kw.bid as Record<string, unknown> | undefined;

                  allKwRows.push({
                    bol_customer_id:    customer.id,
                    keyword_id:         keywordId,
                    keyword_text:       (kw.keywordText as string) ?? null,
                    match_type:         (kw.matchType as string) ?? null,
                    campaign_id:        kw.campaignId as string,
                    ad_group_id:        (kw.adGroupId as string) ?? null,
                    bid:                bid?.amount ?? null,
                    state:              (kw.state as string) ?? null,
                    spend:              p.cost ?? null,
                    impressions:        p.impressions ?? null,
                    clicks:             p.clicks ?? null,
                    revenue:            p.sales14d ?? null,
                    acos:               p.acos14d ?? null,
                    conversions:        p.conversions14d ?? null,
                    period_start_date:  date,  // Single day
                    period_end_date:    date,  // Single day
                  });
                }
              }

              await sleep(200); // Rate limit between days
            } catch (dayError) {
              console.error(`[bol-sync-start] Failed to fetch data for ${date}:`, dayError);
              // Continue with next day
            }
          }

          // Bulk insert all campaign performance rows
          if (allCampRows.length > 0) {
            const { error: campInsertError } = await supabase.from('bol_campaign_performance').insert(allCampRows);
            if (campInsertError) {
              console.error('[bol-sync-start] Failed to insert campaign performance:', campInsertError);
            } else {
              console.log(`[bol-sync-start] Inserted ${allCampRows.length} campaign performance rows`);
            }
          }

          // Bulk insert all keyword performance rows
          if (allKwRows.length > 0) {
            const { error: kwInsertError } = await supabase.from('bol_keyword_performance').insert(allKwRows);
            if (kwInsertError) {
              console.error('[bol-sync-start] Failed to insert keyword performance:', kwInsertError);
            } else {
              console.log(`[bol-sync-start] Inserted ${allKwRows.length} keyword performance rows`);
            }
          }

          // ── AI analysis blob (use today's performance) ──────────────────────
          const today = now.toISOString().slice(0, 10);
          const perf = await getAdsPerformance(adsToken, today, today);
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

          detail.advertising = `${campaigns.length} campaigns, ${allKeywords.length} keywords, score ${analysis.score}`;
        } catch (e) {
          detail.advertising = `FAILED: ${(e as Error).message}`;
        }
      } else {
        detail.advertising = 'skipped (no ads credentials)';
      }

      // ── 5. Returns ────────────────────────────────────────────────────────
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

        detail.returns = `${openRets.length} open, ${handledRets.length} handled, score ${analysis.score}`;
      } catch (e) {
        detail.returns = `FAILED: ${(e as Error).message}`;
      }

      // ── 6. Seller performance indicators ──────────────────────────────────
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
          detail.performance = `${indicators.length} indicators, score ${analysis.score}`;
        } else {
          // Store a placeholder so the dashboard doesn't show a spinner forever
          await supabase.from('bol_analyses').insert({
            bol_customer_id: customer.id,
            snapshot_id:     null,
            category:        'performance',
            score:           100,
            findings:        { indicators_count: 0, at_risk_count: 0, needs_improvement: 0, indicators: [], message: 'No performance data available for current week' },
            recommendations: [],
          });
          detail.performance = 'no indicators returned — placeholder stored';
        }
      } catch (e) {
        detail.performance = `FAILED: ${(e as Error).message}`;
      }

      // Update last_sync_at
      await supabase.from('bol_customers').update({ last_sync_at: new Date().toISOString() }).eq('id', customer.id);

      results.push({ ...ctx, status: 'ok', detail: JSON.stringify(detail) });
    } catch (err) {
      results.push({ ...ctx, status: 'error', detail: (err as Error).message });
    }
  }

  console.log(`[bol-sync-start] processed ${customers.length} customers in ${Date.now() - startedAt}ms`);
  return res.status(200).json({ processed: customers.length, duration_ms: Date.now() - startedAt, results });
}
