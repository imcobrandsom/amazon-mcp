/**
 * Cron 3 — /api/bol-sync-extended
 * Schedule: every 6 hours (see vercel.json)
 *
 * Runs slower per-EAN fetches that would exceed the 60s Vercel timeout
 * if included in the main daily sync:
 *  1. Competitor offers + ratings (per top-50 EANs)
 *  2. Product rank tracking SEARCH + BROWSE (per top-50 EANs)
 *  3. Catalog product enrichment + sales forecast (per top-50 EANs)
 *
 * Auth: same as bol-sync-start (CRON_SECRET or x-webhook-secret).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getCompetingOffers,
  getProductRatings,
  getProductRanks,
  getCatalogProduct,
  getSalesForecast,
  sleep,
} from './_lib/bol-api-client.js';

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

  const supabase  = createAdminClient();
  const startedAt = Date.now();
  const results: Array<{ customerId: string; sellerName: string; status: string; detail: Record<string, unknown> }> = [];

  // Load all active customers
  const { data: customers, error: customersErr } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret')
    .eq('active', true);

  if (customersErr) return res.status(500).json({ error: customersErr.message });
  if (!customers?.length) return res.status(200).json({ message: 'No active bol customers', results: [] });

  for (const customer of customers) {
    const ctx = { customerId: customer.id as string, sellerName: customer.seller_name as string };
    const detail: Record<string, unknown> = {};

    try {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      // ── Load latest offers snapshot to get EANs + offer IDs ────────────────
      const { data: latestSnap } = await supabase
        .from('bol_raw_snapshots')
        .select('raw_data')
        .eq('bol_customer_id', customer.id)
        .eq('data_type', 'listings')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const offers: Record<string, string>[] = (latestSnap?.raw_data as { offers?: Record<string, string>[] })?.offers ?? [];

      if (!offers.length) {
        detail.note = 'No offers snapshot found — skipping extended sync';
        results.push({ ...ctx, status: 'skipped', detail });
        continue;
      }

      // Extract top-50 unique EANs
      const eanSet = new Set<string>();
      const eanOfferMap = new Map<string, string>(); // ean → offerId
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

      // ── Block 1: Competitor data ──────────────────────────────────────────
      let competitorCount = 0;
      for (const ean of eans) {
        try {
          const [competingOffers, ratings] = await Promise.all([
            getCompetingOffers(token, ean),
            getProductRatings(token, ean),
          ]);

          const typed = competingOffers as Array<{
            offerId?: string;
            sellerId?: string;
            price?: { listPrice?: number };
            condition?: string;
            isBuyBoxWinner?: boolean;
          }>;

          const ourOfferId = eanOfferMap.get(ean);
          let ourPrice: number | null = null;
          let buyBoxWinner = false;
          let lowestPrice: number | null = null;

          for (const co of typed) {
            const price = co.price?.listPrice ?? null;
            if (price !== null) {
              if (lowestPrice === null || price < lowestPrice) lowestPrice = price;
              if (co.offerId === ourOfferId) {
                ourPrice    = price;
                buyBoxWinner = co.isBuyBoxWinner ?? false;
              }
            }
          }

          const competitorPrices = typed.map(co => ({
            offerId:        co.offerId,
            sellerId:       co.sellerId,
            price:          co.price?.listPrice ?? null,
            condition:      co.condition,
            isBuyBoxWinner: co.isBuyBoxWinner,
          }));

          await supabase.from('bol_competitor_snapshots').insert({
            bol_customer_id:        customer.id,
            ean,
            offer_id:               ourOfferId ?? null,
            our_price:              ourPrice,
            lowest_competing_price: lowestPrice,
            buy_box_winner:         buyBoxWinner,
            competitor_count:       typed.length,
            competitor_prices:      competitorPrices,
            rating_score:           ratings?.score ?? null,
            rating_count:           ratings?.count ?? null,
          });

          competitorCount++;
        } catch (_) {
          // Skip individual EAN errors silently
        }
        await sleep(150);
      }
      detail.competitors = `${competitorCount}/${eans.length} EANs updated`;

      // ── Block 2: Keyword / product rank data ──────────────────────────────
      let rankCount = 0;
      for (const ean of eans) {
        try {
          const [searchRanks, browseRanks] = await Promise.all([
            getProductRanks(token, ean, 'SEARCH'),
            getProductRanks(token, ean, 'BROWSE'),
          ]);

          const rows: Array<{
            bol_customer_id: string;
            ean: string;
            search_type: string;
            rank: number;
            impressions: number;
            week_of: string;
          }> = [];

          for (const rank of searchRanks) {
            rows.push({
              bol_customer_id: customer.id as string,
              ean,
              search_type:     'SEARCH',
              rank:            rank.rank,
              impressions:     rank.impressions,
              week_of:         rank.weekStartDate,
            });
          }
          for (const rank of browseRanks) {
            rows.push({
              bol_customer_id: customer.id as string,
              ean,
              search_type:     'BROWSE',
              rank:            rank.rank,
              impressions:     rank.impressions,
              week_of:         rank.weekStartDate,
            });
          }

          if (rows.length > 0) {
            await supabase.from('bol_keyword_rankings').insert(rows);
            rankCount++;
          }
        } catch (_) {
          // Skip individual EAN errors silently
        }
        await sleep(100);
      }
      detail.rankings = `${rankCount}/${eans.length} EANs ranked`;

      // ── Block 3: Catalog enrichment + sales forecast (top-20 only) ───────
      // Use top-20 EANs sorted by visits from offer insights if available
      const top20Eans = eans.slice(0, 20);
      const catalogData: Record<string, unknown> = {};
      const forecastData: Record<string, unknown> = {};

      for (const ean of top20Eans) {
        try {
          const catalog = await getCatalogProduct(token, ean);
          if (catalog) catalogData[ean] = catalog;
        } catch (_) {
          // Skip
        }
        await sleep(150);
      }

      // Sales forecast for top-20 offer IDs
      for (const ean of top20Eans) {
        const offerId = eanOfferMap.get(ean);
        if (!offerId) continue;
        try {
          const forecast = await getSalesForecast(token, offerId, 4);
          if (forecast.length > 0) forecastData[offerId] = forecast;
        } catch (_) {
          // Skip
        }
        await sleep(150);
      }

      if (Object.keys(catalogData).length > 0 || Object.keys(forecastData).length > 0) {
        await supabase.from('bol_raw_snapshots').insert({
          bol_customer_id: customer.id,
          data_type:       'listings',
          raw_data:        { catalog: catalogData, forecast: forecastData },
          record_count:    Object.keys(catalogData).length,
          quality_score:   1.0,
        });
      }
      detail.catalog = `${Object.keys(catalogData).length} catalog items, ${Object.keys(forecastData).length} forecasts`;

      results.push({ ...ctx, status: 'ok', detail });
    } catch (err) {
      results.push({ ...ctx, status: 'error', detail: { error: (err as Error).message } });
    }
  }

  console.log(`[bol-sync-extended] processed ${customers.length} customers in ${Date.now() - startedAt}ms`);
  return res.status(200).json({ processed: customers.length, duration_ms: Date.now() - startedAt, results });
}
