/**
 * Cron 1 — /api/bol-sync-start
 * Schedule: daily at 02:00 UTC (see vercel.json)
 *
 * For every active bol_customer this function:
 *  1. Submits an async offers-export job  → stores processStatusId in bol_sync_jobs
 *  2. Fetches inventory synchronously     → stores snapshot + runs analysis
 *  3. Fetches orders synchronously        → stores snapshot + runs analysis
 *
 * The offers export is picked up later by bol-sync-complete (runs every 5 min).
 *
 * Auth: Vercel injects  Authorization: Bearer <CRON_SECRET>  for scheduled calls.
 *       For manual calls supply  x-webhook-secret: <BOL_WEBHOOK_SECRET>.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient }  from './_lib/supabase-admin.js';
import { getBolToken, startOffersExport, getInventory, getOrders } from './_lib/bol-api-client.js';
import { analyzeInventory, analyzeOrders } from './_lib/bol-analysis.js';

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

  // Load all active customers
  const { data: customers, error: customersErr } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret')
    .eq('active', true);

  if (customersErr) return res.status(500).json({ error: customersErr.message });
  if (!customers?.length) return res.status(200).json({ message: 'No active bol customers', results: [] });

  for (const customer of customers) {
    const ctx = { customerId: customer.id as string, sellerName: customer.seller_name as string };
    try {
      const token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string
      );

      // ── 1. Submit async offers export ──────────────────────────────────────
      let offersJobStatus = 'skipped';
      try {
        const processStatusId = await startOffersExport(token);
        await supabase.from('bol_sync_jobs').insert({
          bol_customer_id:   customer.id,
          data_type:         'listings',
          process_status_id: processStatusId,
          status:            'pending',
        });
        offersJobStatus = `job submitted (processStatusId: ${processStatusId})`;
      } catch (e) {
        offersJobStatus = `FAILED: ${(e as Error).message}`;
      }

      // ── 2. Fetch inventory ─────────────────────────────────────────────────
      let inventoryStatus = 'skipped';
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

        inventoryStatus = `${inventory.length} items, score ${analysis.score}`;
      } catch (e) {
        inventoryStatus = `FAILED: ${(e as Error).message}`;
      }

      // ── 3. Fetch orders ────────────────────────────────────────────────────
      let ordersStatus = 'skipped';
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
          category:        'orders',   // stored as 'orders' category in analyses
          score:           analysis.score,
          findings:        analysis.findings,
          recommendations: analysis.recommendations,
        });

        ordersStatus = `${orders.length} orders, score ${analysis.score}`;
      } catch (e) {
        ordersStatus = `FAILED: ${(e as Error).message}`;
      }

      // Update last_sync_at
      await supabase.from('bol_customers').update({ last_sync_at: new Date().toISOString() }).eq('id', customer.id);

      results.push({ ...ctx, status: 'ok', detail: `offers: ${offersJobStatus} | inventory: ${inventoryStatus} | orders: ${ordersStatus}` });
    } catch (err) {
      results.push({ ...ctx, status: 'error', detail: (err as Error).message });
    }
  }

  console.log(`[bol-sync-start] processed ${customers.length} customers in ${Date.now() - startedAt}ms`);
  return res.status(200).json({ processed: customers.length, duration_ms: Date.now() - startedAt, results });
}
