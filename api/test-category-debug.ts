/**
 * GET /api/test-category-debug?customerId=<id>
 *
 * Diagnostic endpoint: shows the current state of category data for a customer.
 * Returns:
 *  - Inventory snapshot: item count + first item field names + sample EANs
 *  - Listings snapshot (offer export): field names + first 3 rows
 *  - bol_product_categories: total count, breakdown by category_slug
 *
 * Usage: GET /api/test-category-debug?customerId=a260ef86-9e3a-47cf-9e59-68bf8418e6d8
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const customerId = (req.query.customerId ?? req.body?.customerId) as string | undefined;
  if (!customerId) {
    return res.status(400).json({ error: 'customerId query param required' });
  }

  const supabase = createAdminClient();

  // ── 1. Latest inventory snapshot ────────────────────────────────────────────
  const { data: inventorySnap } = await supabase
    .from('bol_raw_snapshots')
    .select('id, raw_data, record_count, fetched_at')
    .eq('bol_customer_id', customerId)
    .eq('data_type', 'inventory')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let inventoryInfo: Record<string, unknown> = { status: 'no_snapshot' };
  if (inventorySnap) {
    const rawData  = inventorySnap.raw_data as Record<string, unknown>;
    const topKeys  = Object.keys(rawData); // e.g. ['items'] or ['inventory']
    const items    = (rawData.items ?? rawData.inventory ?? []) as Array<Record<string, unknown>>;
    const firstItem = items[0] ?? null;

    inventoryInfo = {
      snapshot_id:  inventorySnap.id,
      fetched_at:   inventorySnap.fetched_at,
      record_count: inventorySnap.record_count,
      raw_data_top_keys: topKeys,
      items_count:  items.length,
      first_item_keys:  firstItem ? Object.keys(firstItem) : null,
      first_item_sample: firstItem
        ? {
            ean:   (firstItem.ean as string)   ?? '(missing)',
            bsku:  (firstItem.bsku as string)  ?? '(missing)',
            title: (firstItem.title as string) ?? '(missing)',
          }
        : null,
      sample_eans: items.slice(0, 5).map(i => i.ean ?? '(no ean)'),
    };
  }

  // ── 2. Latest listings (offer export) snapshot ──────────────────────────────
  const { data: listingsSnap } = await supabase
    .from('bol_raw_snapshots')
    .select('id, raw_data, record_count, fetched_at')
    .eq('bol_customer_id', customerId)
    .eq('data_type', 'listings')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let listingsInfo: Record<string, unknown> = { status: 'no_snapshot' };
  if (listingsSnap) {
    const rawData  = listingsSnap.raw_data as Record<string, unknown>;
    const offers   = (rawData.offers ?? []) as Array<Record<string, string>>;
    const firstOffer = offers[0] ?? null;

    listingsInfo = {
      snapshot_id:       listingsSnap.id,
      fetched_at:        listingsSnap.fetched_at,
      record_count:      listingsSnap.record_count,
      offers_count:      offers.length,
      csv_field_names:   firstOffer ? Object.keys(firstOffer) : null,
      first_3_offers:    offers.slice(0, 3).map(o => ({
        ean:             o.ean          ?? o['EAN']          ?? '(missing)',
        'offer-id':      o['offer-id']  ?? o['Offer Id']     ?? '(missing)',
        sku:             o.sku          ?? o['SKU']          ?? '(missing)',
        price:           o.price        ?? o['Price']        ?? '(missing)',
        stock:           o.stock        ?? o['Stock Amount'] ?? '(missing)',
        'fulfilment-method': o['fulfilment-method'] ?? o['Fulfilment Method'] ?? '(missing)',
        title:           o.title        ?? o['Product Title'] ?? '(missing)',
      })),
    };
  }

  // ── 3. bol_product_categories ────────────────────────────────────────────────
  const { data: categories, count: catTotal } = await supabase
    .from('bol_product_categories')
    .select('ean, category_slug, category_path, fetched_at', { count: 'exact' })
    .eq('bol_customer_id', customerId)
    .order('fetched_at', { ascending: false });

  const catRows = categories ?? [];

  // Breakdown by slug
  const slugCounts: Record<string, number> = {};
  for (const row of catRows) {
    const slug = (row.category_slug as string) || 'null';
    slugCounts[slug] = (slugCounts[slug] ?? 0) + 1;
  }

  const sortedSlugs = Object.entries(slugCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const oldestFetch  = catRows.length > 0 ? catRows[catRows.length - 1].fetched_at : null;
  const newestFetch  = catRows.length > 0 ? catRows[0].fetched_at : null;
  const sampleRows   = catRows.slice(0, 5).map(r => ({
    ean:          r.ean,
    category_slug: r.category_slug,
    category_path: r.category_path,
    fetched_at:   r.fetched_at,
  }));

  const categoriesInfo = {
    total_rows:    catTotal ?? 0,
    uncategorized: slugCounts['uncategorized'] ?? 0,
    with_category: (catTotal ?? 0) - (slugCounts['uncategorized'] ?? 0) - (slugCounts['null'] ?? 0),
    oldest_fetch:  oldestFetch,
    newest_fetch:  newestFetch,
    slug_breakdown: sortedSlugs,
    sample_rows:   sampleRows,
  };

  return res.status(200).json({
    customer_id:  customerId,
    inventory:    inventoryInfo,
    listings:     listingsInfo,
    categories:   categoriesInfo,
    diagnosis: {
      inventory_has_eans:     inventoryInfo.items_count
        ? (inventoryInfo.sample_eans as string[]).every(e => e !== '(no ean)')
        : 'N/A — no snapshot',
      category_sync_ran:      (catTotal ?? 0) > 0,
      category_sync_complete: (catTotal ?? 0) >= (inventoryInfo.items_count as number ?? 0),
      action_needed: (catTotal ?? 0) === 0
        ? 'POST /api/bol-sync-categories with {"customerId":"<id>"} to start category sync'
        : (catTotal ?? 0) < (inventoryInfo.items_count as number ?? 0)
          ? 'Category sync partially complete — POST /api/bol-sync-categories again to continue'
          : 'Category sync complete',
    },
  });
}
