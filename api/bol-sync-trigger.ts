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
  if (!['main', 'complete', 'extended'].includes(syncType)) {
    return res.status(400).json({ error: "syncType must be 'main', 'complete', or 'extended'" });
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
        const allAdGroups: unknown[] = [];
        for (const campaign of (campaigns as Array<{ campaignId?: string }>).slice(0, 20)) {
          if (campaign.campaignId) {
            allAdGroups.push(...await getAdsAdGroups(adsToken, campaign.campaignId));
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
        report.advertising = { status: 'ok', campaigns: campaigns.length, score: analysis.score };
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
          const offerIds = offers.map((o: Record<string, string>) => o['Offer Id'] ?? o['offer_id'] ?? '').filter(Boolean);
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
      .order('created_at', { ascending: false })
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
    let rankCount = 0;
    for (const ean of eans) {
      try {
        const [searchRanks, browseRanks] = await Promise.all([
          getProductRanks(token, ean, 'SEARCH'),
          getProductRanks(token, ean, 'BROWSE'),
        ]);
        const rows: Array<{ bol_customer_id: string; ean: string; search_type: string; rank: number; impressions: number; week_of: string }> = [];
        for (const rank of searchRanks) rows.push({ bol_customer_id: customerId, ean, search_type: 'SEARCH', rank: rank.rank, impressions: rank.impressions, week_of: rank.weekStartDate });
        for (const rank of browseRanks) rows.push({ bol_customer_id: customerId, ean, search_type: 'BROWSE', rank: rank.rank, impressions: rank.impressions, week_of: rank.weekStartDate });
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

  return res.status(400).json({ error: 'Unknown syncType' });
}
