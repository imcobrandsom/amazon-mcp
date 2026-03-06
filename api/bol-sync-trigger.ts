/**
 * POST /api/bol-sync-trigger
 *
 * Dashboard-initiated sync for a single bol customer.
 * Called from the Follo portal — verified via Supabase JWT.
 *
 * Body: { customerId: string, syncType: 'main' | 'complete' | 'extended' }
 *
 * syncType 'main'     → inventory + orders + ads + returns + performance + starts offers export
 * syncType 'complete' → polls pending offers export jobs for this customer, processes if ready
 * syncType 'extended' → competitor offers + keyword ranks + catalog enrichment (top-50 EANs)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
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
  checkProcessStatus,
  downloadOffersExport,
  getOfferInsights,
  getCompetingOffers,
  getProductRatings,
  getProductRanks,
  getCatalogProduct,
  getSalesForecast,
  sleep,
} from './_lib/bol-api-client.js';
import {
  analyzeContent,
  analyzeInventory,
  analyzeOrders,
  analyzeAdvertising,
  analyzeReturns,
  analyzePerformance,
  type OfferInsightsMap,
} from './_lib/bol-analysis.js';

// ── Auth helper ────────────────────────────────────────────────────────────────

async function verifyUser(req: VercelRequest): Promise<boolean> {
  const auth = req.headers['authorization'] ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  try {
    const supabase = createAdminClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return !error && !!user;
  } catch {
    return false;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!(await verifyUser(req))) {
    return res.status(401).json({ error: 'Unauthorised — valid Supabase session required' });
  }

  const { customerId, syncType } = req.body ?? {};
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  if (!['main', 'complete', 'extended', 'competitor', 'ads'].includes(syncType)) {
    return res.status(400).json({ error: "syncType must be 'main', 'complete', 'extended', 'competitor', or 'ads'" });
  }

  const supabase  = createAdminClient();
  const startedAt = Date.now();

  // Load customer
  const { data: customer, error: customerErr } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret, ads_client_id, ads_client_secret, active')
    .eq('id', customerId)
    .single();

  if (customerErr || !customer) return res.status(404).json({ error: 'Customer not found' });
  if (!customer.active) return res.status(400).json({ error: 'Customer is inactive' });

  // ── syncType: main ────────────────────────────────────────────────────────────
  if (syncType === 'main') {
    let token: string;
    try {
      token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);
    } catch (e) {
      return res.status(400).json({ error: `Bol.com auth failed: ${(e as Error).message}` });
    }

    const report: Record<string, unknown> = {
      customer_id: customer.id,
      seller_name: customer.seller_name,
      started_at:  new Date().toISOString(),
    };

    // 1. Offers export (async — submit job)
    try {
      const processStatusId = await startOffersExport(token);
      await supabase.from('bol_sync_jobs').insert({
        bol_customer_id:   customer.id,
        data_type:         'listings',
        process_status_id: processStatusId,
        status:            'pending',
      });
      report.offers_export = { status: 'job_submitted', process_status_id: processStatusId, note: 'Poll /complete in 1–5 min' };
    } catch (e) {
      report.offers_export = { status: 'failed', error: (e as Error).message };
    }

    // 2. Inventory
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

    // 3. Orders
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

    // 4. Advertising (if credentials exist)
    const adsId     = customer.ads_client_id     as string | null;
    const adsSecret = customer.ads_client_secret as string | null;
    if (adsId && adsSecret) {
      try {
        const adsToken  = await getAdsToken(adsId, adsSecret);
        const campaigns = await getAdsCampaigns(adsToken);

        // Check if backfill needed
        const { data: backfillStatus } = await supabase
          .from('bol_advertising_backfill_status')
          .select('*')
          .eq('bol_customer_id', customer.id)
          .single();

        // Determine how many days to fetch (Bol API supports last 30 days)
        const now = new Date();
        let daysToFetch = 30; // API limit

        if (!backfillStatus) {
          // First sync: fetch last 30 days
          daysToFetch = 30;
          const oldestDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
          await supabase.from('bol_advertising_backfill_status').insert({
            bol_customer_id: customer.id,
            backfill_completed: true,
            oldest_date_fetched: oldestDate,
            completed_at: now.toISOString(),
          });
        } else {
          // Manual sync after backfill: fetch last 30 days to fill any gaps
          // User expects comprehensive sync when manually triggered
          daysToFetch = 30;
        }

        console.log(`[bol-sync-trigger] Fetching ${daysToFetch} days of advertising data...`);

        // Ad groups per campaign (fetch once, reuse for all days)
        const allAdGroups: unknown[] = [];
        for (const campaign of (campaigns as Array<{ campaignId?: string }>).slice(0, 20)) {
          if (campaign.campaignId) {
            allAdGroups.push(...await getAdsAdGroups(adsToken, campaign.campaignId));
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
          console.log(`[bol-sync-trigger] Fetching data for ${date}...`);

          try {
            // Fetch campaign performance for this specific day
            const campSubTotals = (await getAdsCampaignPerformance(adsToken, campaignIds, date, date)) as Array<Record<string, unknown>>;

            // Skip if API returned no data (reporting delay for very recent days).
            // Don't upsert null rows — that would overwrite previously-stored good data.
            if (campSubTotals.length > 0) {
              for (const camp of campaigns as Array<Record<string, unknown>>) {
                const campaignId = camp.campaignId as string;
                const campIdx    = campaignIds.indexOf(campaignId);
                const p: Record<string, unknown> =
                  campSubTotals.find(s => s.entityId   === campaignId) ??
                  campSubTotals.find(s => s.campaignId === campaignId) ??
                  (campIdx >= 0 ? campSubTotals[campIdx] : undefined)  ??
                  {};

                if (Object.keys(p).length === 0) continue; // no activity this day

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
                  period_start_date:  date,
                  period_end_date:    date,
                });
              }
            }

            // Fetch keyword performance for this specific day
            if (keywordIds.length > 0) {
              const kwSubTotals = (await getAdsKeywordPerformance(adsToken, keywordIds, date, date)) as Array<Record<string, unknown>>;

              if (kwSubTotals.length > 0) {
                for (const kw of allKeywords) {
                  const keywordId = kw.keywordId as string;
                  const kwIdx     = keywordIds.indexOf(keywordId);
                  const p: Record<string, unknown> =
                    kwSubTotals.find(s => s.entityId  === keywordId) ??
                    kwSubTotals.find(s => s.keywordId === keywordId) ??
                    (kwIdx >= 0 ? kwSubTotals[kwIdx] : undefined)   ??
                    {};

                  if (Object.keys(p).length === 0) continue;

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
                    period_start_date:  date,
                    period_end_date:    date,
                  });
                }
              }
            }

            await sleep(200); // Rate limit between days
          } catch (dayError) {
            console.error(`[bol-sync-trigger] Failed to fetch data for ${date}:`, dayError);
            // Continue with next day
          }
        }

        // Upsert campaign performance rows (on conflict: overwrite with latest data)
        if (allCampRows.length > 0) {
          const { error: campInsertError } = await supabase
            .from('bol_campaign_performance')
            .upsert(allCampRows, { onConflict: 'bol_customer_id,campaign_id,period_start_date' });
          if (campInsertError) {
            console.error('[bol-sync-trigger] Failed to upsert campaign performance:', campInsertError);
          } else {
            console.log(`[bol-sync-trigger] Upserted ${allCampRows.length} campaign performance rows`);
          }
        }

        // Upsert keyword performance rows (on conflict: overwrite with latest data)
        if (allKwRows.length > 0) {
          const { error: kwInsertError } = await supabase
            .from('bol_keyword_performance')
            .upsert(allKwRows, { onConflict: 'bol_customer_id,keyword_id,period_start_date' });
          if (kwInsertError) {
            console.error('[bol-sync-trigger] Failed to upsert keyword performance:', kwInsertError);
          } else {
            console.log(`[bol-sync-trigger] Upserted ${allKwRows.length} keyword performance rows`);
          }
        }

        // ── AI analysis blob (use last day's performance) ─────────────────────
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
        report.advertising = { status: 'ok', campaigns: campaigns.length, keywords: allKeywords.length, score: analysis.score };
      } catch (e) {
        report.advertising = { status: 'failed', error: (e as Error).message };
      }
    } else {
      report.advertising = { status: 'skipped', note: 'No ads credentials' };
    }

    // 5. Returns
    try {
      const [openRets, handledRets] = await Promise.all([getReturns(token, false), getReturns(token, true)]);
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

    // 6. Performance indicators
    try {
      const indicatorNames = ['CANCELLATION_RATE', 'FULFILMENT_RATE', 'REVIEW_SCORE'] as const;
      const rawIndicators  = await Promise.all(indicatorNames.map(n => getPerformanceIndicator(token, n)));
      const indicators     = rawIndicators.filter(Boolean) as NonNullable<typeof rawIndicators[0]>[];
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
        // Store a placeholder so the dashboard doesn't show a spinner forever
        await supabase.from('bol_analyses').insert({
          bol_customer_id: customer.id,
          snapshot_id:     null,
          category:        'performance',
          score:           100,
          findings:        { indicators_count: 0, at_risk_count: 0, needs_improvement: 0, indicators: [], message: 'No performance data available for current week' },
          recommendations: [],
        });
        report.performance = { status: 'no_data', note: 'Placeholder stored so dashboard can render' };
      }
    } catch (e) {
      report.performance = { status: 'failed', error: (e as Error).message };
    }

    // ── Auto-populate keywords if empty (Phase 1 setup) ──────────────────────
    try {
      const { count: keywordCount } = await supabase
        .from('bol_product_keyword_targets')
        .select('id', { count: 'exact', head: true })
        .eq('bol_customer_id', customer.id);

      if (keywordCount === 0 && customer.ads_client_id && customer.ads_client_secret) {
        console.log('[bol-sync-trigger] No keywords found, auto-populating from advertising...');

        // Import populate logic inline to avoid circular dependencies
        const adsToken = await getAdsToken(customer.ads_client_id as string, customer.ads_client_secret as string);
        const campaigns = await getAdsCampaigns(adsToken);

        let keywordsMapped = 0;
        for (const campaign of (campaigns as Array<{ campaignId?: string; state?: string }>).slice(0, 20)) {
          if (campaign.campaignId && campaign.state === 'ENABLED') {
            const adGroups = await getAdsAdGroups(adsToken, campaign.campaignId);

            for (const adGroup of (adGroups as Array<{ adGroupId?: string }>).slice(0, 40)) {
              if (!adGroup.adGroupId) continue;

              const [keywords, productTargets] = await Promise.all([
                getAdsKeywords(adsToken, adGroup.adGroupId),
                fetch(`https://advertising-api.bol.com/v10/ad-groups/${adGroup.adGroupId}/product-targets`, {
                  headers: { 'Authorization': `Bearer ${adsToken}`, 'Accept': 'application/vnd.advertising.v10+json' }
                }).then(r => r.ok ? r.json() : { productTargets: [] }).then(d => (d as any).productTargets || [])
              ]);

              const eans = (productTargets as Array<{ ean?: string }>).map(t => t.ean).filter(Boolean) as string[];

              for (const kw of (keywords as Array<{ keywordText?: string; bid?: { amount?: number } }>)) {
                if (!kw.keywordText) continue;
                const priority = Math.min(10, Math.max(1, Math.round((kw.bid?.amount ?? 0.5) * 10)));

                for (const ean of eans) {
                  await supabase.from('bol_product_keyword_targets').insert({
                    bol_customer_id: customer.id,
                    ean,
                    keyword: kw.keywordText.toLowerCase().trim(),
                    priority,
                    source: 'advertising',
                  }).select('id').maybeSingle(); // maybeSingle to ignore duplicates
                  keywordsMapped++;
                }
              }

              await sleep(100);
            }
            await sleep(100);
          }
        }

        console.log(`[bol-sync-trigger] Auto-populated ${keywordsMapped} keyword-product mappings`);
        (report as any).keywords_auto_populated = keywordsMapped;

        // Auto-sync keyword metadata (in_title, in_description flags)
        if (keywordsMapped > 0) {
          console.log('[bol-sync-trigger] Auto-syncing keyword metadata...');
          const { data: keywords } = await supabase
            .from('bol_product_keyword_targets')
            .select('id, ean, keyword')
            .eq('bol_customer_id', customer.id);

          if (keywords && keywords.length > 0) {
            const { data: invSnapshot } = await supabase
              .from('bol_raw_snapshots')
              .select('raw_data')
              .eq('bol_customer_id', customer.id)
              .eq('data_type', 'inventory')
              .order('fetched_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const inventory = ((invSnapshot?.raw_data as any)?.inventory || []) as Array<{
              ean?: string;
              title?: string;
              description?: string;
            }>;

            let updated = 0;
            for (const kw of keywords) {
              const prod = inventory.find(p => p.ean === kw.ean);
              if (!prod) continue;

              const title = (prod.title || '').toLowerCase();
              const desc = (prod.description || '').toLowerCase();
              const kwLower = kw.keyword.toLowerCase();

              await supabase
                .from('bol_product_keyword_targets')
                .update({
                  in_title: title.includes(kwLower),
                  in_description: desc.includes(kwLower),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', kw.id);
              updated++;
            }

            console.log(`[bol-sync-trigger] Auto-synced ${updated} keyword metadata records`);
            (report as any).keywords_metadata_synced = updated;
          }
        }
      }
    } catch (e) {
      console.error('[bol-sync-trigger] Auto-populate keywords failed:', e);
      (report as any).keywords_auto_populate_error = (e as Error).message;
    }

    await supabase.from('bol_customers').update({ last_sync_at: new Date().toISOString() }).eq('id', customer.id);
    report.duration_ms = Date.now() - startedAt;
    return res.status(200).json(report);
  }

  // ── syncType: complete ─────────────────────────────────────────────────────────
  if (syncType === 'complete') {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: pendingJobs, error: jobsErr } = await supabase
      .from('bol_sync_jobs')
      .select('id, bol_customer_id, process_status_id, attempts')
      .eq('status', 'pending')
      .eq('bol_customer_id', customerId)
      .gte('started_at', cutoff)
      .order('started_at', { ascending: true });

    if (jobsErr) return res.status(500).json({ error: jobsErr.message });

    if (!pendingJobs?.length) {
      return res.status(200).json({
        message:    'No pending jobs for this customer',
        checked:    0,
        duration_ms: Date.now() - startedAt,
      });
    }

    let token: string;
    try {
      token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);
    } catch (e) {
      return res.status(400).json({ error: `Bol.com auth failed: ${(e as Error).message}` });
    }

    const results: Array<{ jobId: string; status: string; detail: string }> = [];

    for (const job of pendingJobs) {
      const jobId = job.id as string;

      if ((job.attempts as number) >= 50) {
        await supabase.from('bol_sync_jobs').update({
          status: 'failed', error: 'Exceeded max attempts', completed_at: new Date().toISOString(),
        }).eq('id', jobId);
        results.push({ jobId, status: 'failed', detail: 'Max attempts exceeded' });
        continue;
      }

      try {
        const { status, entityId } = await checkProcessStatus(token, job.process_status_id as string);
        await supabase.from('bol_sync_jobs').update({ attempts: (job.attempts as number) + 1 }).eq('id', jobId);

        if (status === 'SUCCESS' && entityId) {
          const offers = await downloadOffersExport(token, entityId);

          // Offer insights
          const insightsMap: OfferInsightsMap = {};
          // bol.com v10 offers export CSV uses 'offer-id' (hyphen); accept all variants
          const offerIds = offers.map((o: Record<string, string>) => o['offer-id'] ?? o['Offer Id'] ?? o['offer_id'] ?? '').filter(Boolean);
          for (let i = 0; i < offerIds.length; i += 20) {
            const batch   = offerIds.slice(i, i + 20);
            const rawList = await getOfferInsights(token, batch);
            for (const raw of rawList as Array<{ offerId: string; offerInsightData: Array<{ name: string; periods: Array<{ value: number }> }> }>) {
              if (!raw.offerId) continue;
              const getVal = (name: string) => raw.offerInsightData?.find((d: { name: string }) => d.name === name)?.periods?.[0]?.value ?? 0;
              insightsMap[raw.offerId] = {
                buyBoxPct:   getVal('BUY_BOX_PERCENTAGE') || null,
                visits:      getVal('PRODUCT_VISITS'),
                impressions: getVal('IMPRESSIONS'),
                clicks:      getVal('CLICKS'),
                conversions: getVal('CONVERSIONS'),
              } as OfferInsightsMap[string];
            }
            if (i + 20 < offerIds.length) await sleep(200);
          }

          if (Object.keys(insightsMap).length > 0) {
            await supabase.from('bol_raw_snapshots').insert({
              bol_customer_id: customer.id,
              data_type:       'offer_insights',
              raw_data:        { insights: insightsMap },
              record_count:    Object.keys(insightsMap).length,
              quality_score:   1.0,
            });
          }

          const analysis = analyzeContent(offers, insightsMap);
          const { data: snap } = await supabase.from('bol_raw_snapshots').insert({
            bol_customer_id: customer.id,
            data_type:       'listings',
            raw_data:        { offers },
            record_count:    offers.length,
            quality_score:   offers.length > 0 ? 1.0 : 0.5,
          }).select('id').single();

          await supabase.from('bol_analyses').insert({
            bol_customer_id: customer.id,
            snapshot_id:     snap?.id ?? null,
            category:        'content',
            score:           analysis.score,
            findings:        analysis.findings,
            recommendations: analysis.recommendations,
          });

          await supabase.from('bol_sync_jobs').update({
            status: 'completed', entity_id: entityId, completed_at: new Date().toISOString(),
          }).eq('id', jobId);

          results.push({ jobId, status: 'completed', detail: `${offers.length} offers processed, content score ${analysis.score}` });

        } else if (status === 'FAILURE') {
          await supabase.from('bol_sync_jobs').update({
            status: 'failed', error: 'Bol.com FAILURE', completed_at: new Date().toISOString(),
          }).eq('id', jobId);
          results.push({ jobId, status: 'failed', detail: 'Bol.com reported FAILURE' });
        } else {
          results.push({ jobId, status: 'pending', detail: `bol.com status: ${status} — export not ready yet. Bol.com typically takes 2–5 minutes to generate the file. Run Phase 2 again shortly.` });
        }
      } catch (err) {
        results.push({ jobId, status: 'error', detail: (err as Error).message });
      }
    }

    const completed   = results.filter(r => r.status === 'completed').length;
    const stillPending = results.filter(r => r.status === 'pending').length;
    return res.status(200).json({
      checked:      pendingJobs.length,
      completed,
      still_pending: stillPending,
      duration_ms:   Date.now() - startedAt,
      results,
    });
  }

  // ── syncType: ads ──────────────────────────────────────────────────────────────
  // Advertising-only sync: fetches 30 days of campaign + keyword performance.
  // Faster than 'main' because it skips inventory, orders, returns, and performance
  // indicators. Use this to backfill or refresh ad data without running the full sync.
  if (syncType === 'ads') {
    const adsId     = customer.ads_client_id     as string | null;
    const adsSecret = customer.ads_client_secret as string | null;

    if (!adsId || !adsSecret) {
      return res.status(400).json({ error: 'No ads credentials configured for this customer' });
    }

    let adsToken: string;
    try {
      adsToken = await getAdsToken(adsId, adsSecret);
    } catch (e) {
      return res.status(400).json({ error: `Bol.com Ads auth failed: ${(e as Error).message}` });
    }

    const now = new Date();
    const daysToFetch = 30; // Always fetch full 30 days (API maximum)
    const report: Record<string, unknown> = {
      customer_id: customer.id,
      seller_name: customer.seller_name,
      started_at:  now.toISOString(),
      days_fetched: daysToFetch,
    };

    try {
      // Campaign-only: skip ad groups + keywords setup to save ~60 API calls (~30s).
      // This keeps the ads sync well within the 300s function limit.
      const campaigns   = await getAdsCampaigns(adsToken);
      const campaignIds = (campaigns as Array<{ campaignId?: string }>)
        .filter(c => c.campaignId).map(c => c.campaignId as string);

      const allCampRows: Array<Record<string, unknown>> = [];
      let daysWithData   = 0;
      let daysWithErrors = 0;

      // Fetch 2 days in parallel per batch → ~15 batches × ~500ms = ~7.5s total.
      const CONCURRENT = 2;
      for (let batchStart = daysToFetch - 1; batchStart >= 0; batchStart -= CONCURRENT) {
        const dayOffsets = Array.from(
          { length: Math.min(CONCURRENT, batchStart + 1) },
          (_, i) => batchStart - i
        );

        await Promise.all(dayOffsets.map(async (dayOffset) => {
          const date = new Date(now.getTime() - dayOffset * 86400000).toISOString().slice(0, 10);
          try {
            const campSubTotals = (await getAdsCampaignPerformance(adsToken, campaignIds, date, date)) as Array<Record<string, unknown>>;

            // If the API returned no data at all for this day (reporting delay for
            // very recent days), skip entirely — don't upsert null rows that would
            // overwrite previously-stored good data.
            if (campSubTotals.length === 0) {
              daysWithData++; // still counts as "attempted"
              return;
            }

            for (const camp of campaigns as Array<Record<string, unknown>>) {
              const campaignId = camp.campaignId as string;
              const campIdx    = campaignIds.indexOf(campaignId);
              // Three-way lookup: by entityId → by campaignId → positional (Bol returns
              // subTotals in the same order as the entity-ids request param).
              const p: Record<string, unknown> =
                campSubTotals.find(s => s.entityId   === campaignId) ??
                campSubTotals.find(s => s.campaignId === campaignId) ??
                (campIdx >= 0 ? campSubTotals[campIdx] : undefined)  ??
                {};

              // Skip if we still have no match (campaign had zero activity this day).
              if (Object.keys(p).length === 0) continue;

              const budget = camp.dailyBudget as Record<string, unknown> | undefined;

              allCampRows.push({
                bol_customer_id:   customer.id,
                campaign_id:       campaignId,
                campaign_name:     (camp.name as string) ?? null,
                campaign_type:     (camp.campaignType as string) ?? null,
                state:             (camp.state as string) ?? null,
                budget:            budget?.amount ?? null,
                spend:             p.cost ?? null,
                impressions:       p.impressions ?? null,
                clicks:            p.clicks ?? null,
                ctr_pct:           p.ctr ?? null,
                avg_cpc:           p.averageCpc ?? null,
                revenue:           p.sales14d ?? null,
                roas:              p.roas14d ?? null,
                acos:              p.acos14d ?? null,
                conversions:       p.conversions14d ?? null,
                cvr_pct:           p.conversionRate14d ?? null,
                period_start_date: date,
                period_end_date:   date,
              });
            }
            daysWithData++;
          } catch (dayError) {
            console.error(`[bol-sync-trigger/ads] Failed for ${date}:`, dayError);
            daysWithErrors++;
          }
        }));
      }

      // Upsert campaign rows (overwrites on conflict — no duplicates)
      if (allCampRows.length > 0) {
        const { error: campErr } = await supabase
          .from('bol_campaign_performance')
          .upsert(allCampRows, { onConflict: 'bol_customer_id,campaign_id,period_start_date' });
        if (campErr) console.error('[bol-sync-trigger/ads] Campaign upsert error:', campErr);
      }

      report.advertising = {
        status:             'ok',
        campaigns:          campaigns.length,
        days_with_data:     daysWithData,
        days_with_errors:   daysWithErrors,
        camp_rows_upserted: allCampRows.length,
        kw_rows_upserted:   0, // campaign-only sync; keywords synced via 'main'
      };
    } catch (e) {
      report.advertising = { status: 'failed', error: (e as Error).message };
    }

    await supabase.from('bol_customers').update({ last_sync_at: new Date().toISOString() }).eq('id', customer.id);
    report.duration_ms = Date.now() - startedAt;
    return res.status(200).json(report);
  }

  // ── syncType: extended ─────────────────────────────────────────────────────────
  if (syncType === 'extended') {
    let token: string;
    try {
      token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);
    } catch (e) {
      return res.status(400).json({ error: `Bol.com auth failed: ${(e as Error).message}` });
    }

    const detail: Record<string, unknown> = {};

    // Load latest offers snapshot to get EANs
    const { data: latestSnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    const offers: Record<string, string>[] = (latestSnap?.raw_data as { offers?: Record<string, string>[] })?.offers ?? [];

    if (!offers.length) {
      return res.status(200).json({
        message:     'No offers snapshot found — run main sync first',
        duration_ms: Date.now() - startedAt,
      });
    }

    // Extract top-50 unique EANs
    const eanSet    = new Set<string>();
    const eanOfferMap = new Map<string, string>();
    for (const offer of offers) {
      const ean     = offer['EAN'] ?? offer['ean'] ?? '';
      const offerId = offer['Offer Id'] ?? offer['offer_id'] ?? '';
      if (ean && !eanSet.has(ean)) {
        eanSet.add(ean);
        eanOfferMap.set(ean, offerId);
      }
      if (eanSet.size >= 50) break;
    }
    const eans = Array.from(eanSet);

    // Block 1: Competitor data
    let competitorCount = 0;
    for (const ean of eans) {
      try {
        const [competingOffers, ratings] = await Promise.all([
          getCompetingOffers(token, ean),
          getProductRatings(token, ean),
        ]);
        const typed = competingOffers as Array<{
          offerId?: string; sellerId?: string;
          price?: { listPrice?: number }; condition?: string; isBuyBoxWinner?: boolean;
        }>;
        const ourOfferId  = eanOfferMap.get(ean);
        let ourPrice: number | null = null;
        let buyBoxWinner  = false;
        let lowestPrice: number | null = null;
        for (const co of typed) {
          const price = co.price?.listPrice ?? null;
          if (price !== null) {
            if (lowestPrice === null || price < lowestPrice) lowestPrice = price;
            if (co.offerId === ourOfferId) { ourPrice = price; buyBoxWinner = co.isBuyBoxWinner ?? false; }
          }
        }
        await supabase.from('bol_competitor_snapshots').insert({
          bol_customer_id:        customerId,
          ean,
          offer_id:               ourOfferId ?? null,
          our_price:              ourPrice,
          lowest_competing_price: lowestPrice,
          buy_box_winner:         buyBoxWinner,
          competitor_count:       typed.length,
          competitor_prices:      typed.map(co => ({ offerId: co.offerId, sellerId: co.sellerId, price: co.price?.listPrice ?? null, condition: co.condition, isBuyBoxWinner: co.isBuyBoxWinner })),
          rating_score:           (ratings as { score?: number } | null)?.score ?? null,
          rating_count:           (ratings as { count?: number } | null)?.count ?? null,
        });
        competitorCount++;
      } catch { /* skip individual EAN errors */ }
      await sleep(150);
    }
    detail.competitors = `${competitorCount}/${eans.length} EANs updated`;

    // Block 2: Keyword rankings
    // Note: getProductRanks now requires a date parameter - use yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    let rankCount = 0;
    for (const ean of eans) {
      try {
        const [searchRanks, browseRanks] = await Promise.all([
          getProductRanks(token, ean, dateStr, 'SEARCH'),
          getProductRanks(token, ean, dateStr, 'BROWSE'),
        ]);
        const rows: Array<{ bol_customer_id: string; ean: string; search_type: string; rank: number; impressions: number; week_of: string }> = [];
        // New response format: { ranks: BolProductRank[], hasNextPage: boolean }
        for (const rank of searchRanks.ranks) rows.push({ bol_customer_id: customerId, ean, search_type: 'SEARCH', rank: rank.rank, impressions: rank.impressions, week_of: dateStr });
        for (const rank of browseRanks.ranks) rows.push({ bol_customer_id: customerId, ean, search_type: 'BROWSE', rank: rank.rank, impressions: rank.impressions, week_of: dateStr });
        if (rows.length > 0) { await supabase.from('bol_keyword_rankings').insert(rows); rankCount++; }
      } catch { /* skip */ }
      await sleep(100);
    }
    detail.rankings = `${rankCount}/${eans.length} EANs ranked`;

    // Block 3: Catalog + forecast (top-20 only)
    const top20 = eans.slice(0, 20);
    const catalogData: Record<string, unknown> = {};
    const forecastData: Record<string, unknown> = {};
    for (const ean of top20) {
      try { const c = await getCatalogProduct(token, ean); if (c) catalogData[ean] = c; } catch { /* skip */ }
      await sleep(150);
    }
    for (const ean of top20) {
      const offerId = eanOfferMap.get(ean);
      if (!offerId) continue;
      try { const f = await getSalesForecast(token, offerId, 4); if (f.length > 0) forecastData[offerId] = f; } catch { /* skip */ }
      await sleep(150);
    }
    if (Object.keys(catalogData).length > 0 || Object.keys(forecastData).length > 0) {
      await supabase.from('bol_raw_snapshots').insert({
        bol_customer_id: customerId,
        data_type:       'listings',
        raw_data:        { catalog: catalogData, forecast: forecastData },
        record_count:    Object.keys(catalogData).length,
        quality_score:   1.0,
      });
    }
    detail.catalog = `${Object.keys(catalogData).length} catalog items, ${Object.keys(forecastData).length} forecasts`;

    return res.status(200).json({
      customer_id: customerId,
      seller_name: customer.seller_name,
      duration_ms: Date.now() - startedAt,
      detail,
    });
  }

  // ── syncType: competitor ───────────────────────────────────────────────────────
  if (syncType === 'competitor') {
    // This triggers the full competitor analysis sync (8-step flow)
    // Note: This is a heavy operation that can take 10-15 minutes on first run
    try {
      // Import and execute the competitor analysis sync directly
      const { default: competitorAnalysisHandler } = await import('./bol-sync-competitor-analysis.js');

      // Create a mock request with internal call flag
      const mockReq = {
        method: 'POST',
        headers: {
          'x-internal-call': 'true', // Mark as internal call to bypass auth
        },
        query: {},
        body: { customerId }, // Pass customerId in body
      } as VercelRequest;

      // Create a response capture object
      let responseData: any = null;
      let responseStatus = 200;
      const mockRes = {
        status: (code: number) => {
          responseStatus = code;
          return mockRes;
        },
        json: (data: any) => {
          responseData = data;
          return mockRes;
        },
      } as VercelResponse;

      // Execute the competitor analysis sync
      await competitorAnalysisHandler(mockReq, mockRes);

      // Transform response to match BolSyncResult format
      if (responseStatus !== 200 || !responseData) {
        return res.status(responseStatus).json(responseData || { error: 'Competitor analysis failed' });
      }

      // Extract results from competitor analysis response
      const results = responseData.results || [];
      const customerResult = results.find((r: any) => r.customerId === customerId);

      if (!customerResult || customerResult.status === 'error') {
        return res.status(500).json({
          error: customerResult?.detail?.error || 'Competitor analysis failed',
          message: responseData.message,
          duration_ms: Date.now() - startedAt,
        });
      }

      // Extract stats from detail object
      const detail = customerResult.detail || {};
      const categoriesDetected = detail.categoriesDetected?.match(/(\d+)\//) ?
        parseInt(detail.categoriesDetected.match(/(\d+)\//)[1]) : 0;
      const uniqueCategories = detail.uniqueCategories?.match(/(\d+)/) ?
        parseInt(detail.uniqueCategories.match(/(\d+)/)[1]) : 0;

      return res.status(200).json({
        customer_id: customerId,
        seller_name: customer.seller_name,
        duration_ms: Date.now() - startedAt,
        categories_detected: categoriesDetected,
        categories_processed: uniqueCategories,
        categories_analyzed: detail.categories_analyzed || 0,
        competitors_found: detail.competitors_found || 0,
        keywords_analyzed: detail.keywords_analyzed || 0,
        message: responseData.message || 'Competitor analysis completed',
        detail,
      });
    } catch (e) {
      return res.status(500).json({
        error: `Competitor analysis failed: ${(e as Error).message}`,
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  return res.status(400).json({ error: 'Unknown syncType' });
}
