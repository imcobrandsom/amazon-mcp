/**
 * POST /api/bol-sync-catalog
 * Fetch and store catalog attributes (including descriptions) for all products
 *
 * This runs as a separate sync because:
 * - Requires one API call per product (rate-limited)
 * - Only needs to run occasionally (catalog data changes infrequently)
 * - Can take 5-10 minutes for large catalogs
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';
import { getBolToken, getCatalogProduct, sleep } from './_lib/bol-api-client.js.js';

interface CatalogAttribute {
  id: string;
  values: Array<{ value: string; valueId?: string; unitId?: string }>;
}

interface CatalogData {
  published: boolean;
  gpc?: { chunkId: string };
  enrichment?: { status: number };
  attributes?: CatalogAttribute[];
  parties?: Array<{ name: string; type: string; role: string }>;
}

function extractCatalogAttributes(catalog: CatalogData): Record<string, unknown> {
  if (!catalog.attributes) return {};

  const attrs: Record<string, unknown> = {};

  for (const attr of catalog.attributes) {
    const key = attr.id;

    // Handle multi-value attributes
    if (attr.values.length === 1) {
      attrs[key] = attr.values[0].value;
    } else if (attr.values.length > 1) {
      // Store as array if multiple values
      attrs[key] = attr.values.map(v => v.value);
    }
  }

  // Add metadata
  attrs._published = catalog.published;
  attrs._gpc_chunk_id = catalog.gpc?.chunkId ?? null;
  attrs._enrichment_status = catalog.enrichment?.status ?? null;
  attrs._brand = catalog.parties?.find(p => p.role === 'BRAND')?.name ?? null;

  return attrs;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { customerId, maxProducts } = req.body as { customerId?: string; maxProducts?: number };

  if (!customerId) {
    return res.status(400).json({ error: 'customerId required in body' });
  }

  // Limit processing to avoid Vercel timeout (60s for Hobby, 300s for Pro)
  const MAX_PRODUCTS = maxProducts ?? 50; // Process max 50 products per invocation (~5-6 seconds)

  const supabase = createAdminClient();
  const startedAt = Date.now();

  try {
    // Get customer
    const { data: customer } = await supabase
      .from('bol_customers')
      .select('id, seller_name, bol_client_id, bol_client_secret')
      .eq('id', customerId)
      .single();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const token = await getBolToken(
      customer.bol_client_id as string,
      customer.bol_client_secret as string
    );

    // Get all unique EANs from latest inventory snapshot
    const { data: inventorySnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (!inventorySnap) {
      return res.status(404).json({ error: 'No inventory data found - run main sync first' });
    }

    const items = ((inventorySnap.raw_data as Record<string, unknown>)?.items as Array<{ ean: string }>) ?? [];
    const uniqueEans = [...new Set(items.map(item => item.ean))];

    // Check which EANs already have catalog data
    const { data: existingCatalog } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog');

    const processedEans = new Set(
      (existingCatalog ?? []).map(snap => (snap.raw_data as Record<string, unknown>).ean as string)
    );

    const pendingEans = uniqueEans.filter(ean => !processedEans.has(ean));

    console.log(
      `[bol-sync-catalog] Total: ${uniqueEans.length}, Already processed: ${processedEans.size}, ` +
      `Pending: ${pendingEans.length}, Will process: ${Math.min(MAX_PRODUCTS, pendingEans.length)}`
    );

    if (pendingEans.length === 0) {
      return res.status(200).json({
        customer_id: customerId,
        seller_name: customer.seller_name,
        message: 'All products already have catalog data',
        total_eans: uniqueEans.length,
        already_processed: processedEans.size,
        pending: 0,
      });
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ ean: string; error: string }> = [];

    // Process only MAX_PRODUCTS to stay within Vercel timeout
    const eansToProcess = pendingEans.slice(0, MAX_PRODUCTS);

    for (const ean of eansToProcess) {
      try {
        const catalog = await getCatalogProduct(token, ean);

        if (!catalog) {
          errorCount++;
          errors.push({ ean, error: 'No catalog data returned' });
          continue;
        }

        const attributes = extractCatalogAttributes(catalog as CatalogData);

        // Store in bol_raw_snapshots with data_type = 'catalog'
        await supabase.from('bol_raw_snapshots').insert({
          bol_customer_id: customerId,
          data_type: 'catalog',
          raw_data: { ean, catalog },
          catalog_attributes: attributes,
          record_count: 1,
          quality_score: catalog ? 1.0 : 0.0,
        });

        successCount++;

        // Rate limiting: 100ms between calls = max 10 calls/second
        await sleep(100);
      } catch (err) {
        errorCount++;
        const errorMsg = (err as Error).message;
        errors.push({ ean, error: errorMsg });
        console.error(`[bol-sync-catalog] Failed for EAN ${ean}:`, errorMsg);

        // If we hit rate limit, wait longer
        if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
          console.warn('[bol-sync-catalog] Rate limited - waiting 5s');
          await sleep(5000);
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const remaining = pendingEans.length - eansToProcess.length;

    return res.status(200).json({
      customer_id: customerId,
      seller_name: customer.seller_name,
      total_eans: uniqueEans.length,
      already_processed: processedEans.size,
      processed_this_run: successCount,
      failed_this_run: errorCount,
      remaining_to_process: remaining,
      duration_ms: durationMs,
      complete: remaining === 0,
      message: remaining > 0 ? `Run again to process ${remaining} more products` : 'All products processed',
      errors: errors.slice(0, 10), // Return first 10 errors only
    });

  } catch (err) {
    console.error('[bol-sync-catalog] Fatal error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
