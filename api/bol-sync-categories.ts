/**
 * POST /api/bol-sync-categories
 *
 * Fetches product categories from the Bol.com Placement API for ALL products,
 * independent of competitor data.
 *
 * Design goals:
 * - Works for every customer automatically (cron) or one customer (trigger/manual)
 * - Processes products that are missing a category OR have stale data (> STALE_DAYS)
 * - Runs in small batches (BATCH_SIZE) to stay within the Vercel 60s timeout
 * - Self-triggers next batch when more products remain
 * - Called fire-and-forget by the main sync after inventory is loaded
 * - Also runs as a daily cron (02:30 UTC, after main sync at 02:00 UTC)
 *
 * No extra table needed: absence of a row (or stale fetched_at) is the signal.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  getBolToken,
  getProductPlacement,
  extractDeepestCategoryId,
  extractCategoryPath,
  sleep,
} from './_lib/bol-api-client.js';

const BATCH_SIZE    = 40;   // EANs per run  (40 × 250 ms ≈ 10 s, well inside 60 s limit)
const STALE_DAYS    = 7;    // Re-fetch categories older than this many days
const RATE_LIMIT_MS = 250;  // ms between Bol placement API calls (conservative)

/**
 * Normalize a category name to a URL-safe slug, handling Dutch diacritics.
 * "Sportshirts & Tops" → "sportshirts-tops"
 * "Sportvêtements"     → "sportvtements"
 */
function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics: é→e, ë→e, ö→o
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = createAdminClient();
  const { customerId } = (req.body as { customerId?: string }) || {};

  // ── Load customers ──────────────────────────────────────────────────────────
  type Customer = { id: string; seller_name: string; bol_client_id: unknown; bol_client_secret: unknown };
  let customers: Customer[];

  if (customerId) {
    const { data } = await supabase
      .from('bol_customers')
      .select('id, seller_name, bol_client_id, bol_client_secret')
      .eq('id', customerId)
      .single();
    customers = data ? [data as Customer] : [];
  } else {
    const { data } = await supabase
      .from('bol_customers')
      .select('id, seller_name, bol_client_id, bol_client_secret')
      .eq('active', true);
    customers = (data ?? []) as Customer[];
  }

  if (!customers.length) {
    return res.status(200).json({ message: 'No customers to process', results: [] });
  }

  const staleThreshold = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const results: object[] = [];

  for (const customer of customers) {
    console.log(`[sync-categories] Processing customer: ${customer.seller_name} (${customer.id})`);

    // 1. All EANs from latest inventory snapshot
    const { data: inventorySnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customer.id)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inventorySnap) {
      console.log(`[sync-categories] No inventory snapshot for ${customer.seller_name} – skipping`);
      results.push({ customer: customer.seller_name, status: 'skipped', reason: 'no_inventory' });
      continue;
    }

    const rawData = inventorySnap.raw_data as Record<string, unknown>;
    const allEans: string[] = (
      (rawData?.items as Array<{ ean?: string }>) ??
      (rawData?.inventory as Array<{ ean?: string }>) ??
      []
    )
      .map((p) => p.ean)
      .filter((e): e is string => Boolean(e));

    if (!allEans.length) {
      results.push({ customer: customer.seller_name, status: 'skipped', reason: 'empty_inventory' });
      continue;
    }

    // 2. Which EANs already have fresh category data?
    const { data: existing } = await supabase
      .from('bol_product_categories')
      .select('ean, fetched_at')
      .eq('bol_customer_id', customer.id);

    const freshEans = new Set(
      (existing ?? [])
        .filter((r) => r.fetched_at > staleThreshold)
        .map((r) => r.ean as string),
    );

    const eansToFetch = allEans.filter((ean) => !freshEans.has(ean));

    if (!eansToFetch.length) {
      console.log(`[sync-categories] All ${allEans.length} products are up to date for ${customer.seller_name}`);
      results.push({ customer: customer.seller_name, status: 'up_to_date', total: allEans.length });
      continue;
    }

    console.log(`[sync-categories] ${eansToFetch.length} EANs need category data (${allEans.length} total)`);

    // 3. Authenticate with Bol.com Retailer API
    let token: string;
    try {
      token = await getBolToken(
        customer.bol_client_id as string,
        customer.bol_client_secret as string,
      );
    } catch (e) {
      console.error(`[sync-categories] Auth failed for ${customer.seller_name}:`, (e as Error).message);
      results.push({ customer: customer.seller_name, status: 'auth_failed', error: (e as Error).message });
      continue;
    }

    // 4. Process the next batch
    const batch = eansToFetch.slice(0, BATCH_SIZE);
    let fetchedCount = 0;
    let uncategorizedCount = 0;

    const upsertRows: Array<{
      bol_customer_id: string;
      ean: string;
      category_id: string | null;
      category_path: string | null;
      category_slug: string;
      fetched_at: string;
    }> = [];

    for (const ean of batch) {
      const placement = await getProductPlacement(token, ean);
      const categoryId   = extractDeepestCategoryId(placement);
      const categoryPath = extractCategoryPath(placement);

      // Derive the leaf category name (most specific level)
      const pathParts    = categoryPath?.split(' > ') ?? [];
      const categoryName = pathParts[pathParts.length - 1] ?? null;

      const categorySlug = categoryName
        ? toSlug(categoryName)
        : categoryId
          ? `cat-${toSlug(categoryId)}`
          : 'uncategorized';

      upsertRows.push({
        bol_customer_id: customer.id,
        ean,
        category_id:   categoryId,
        category_path: categoryPath,
        category_slug: categorySlug,
        fetched_at:    new Date().toISOString(),
      });

      if (categorySlug === 'uncategorized') {
        uncategorizedCount++;
      } else {
        fetchedCount++;
      }

      await sleep(RATE_LIMIT_MS);
    }

    // 5. Persist results
    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('bol_product_categories')
        .upsert(upsertRows, { onConflict: 'bol_customer_id,ean', ignoreDuplicates: false });

      if (upsertErr) {
        console.error(`[sync-categories] Upsert error:`, upsertErr.message);
      } else {
        console.log(`[sync-categories] Upserted ${upsertRows.length} rows (${fetchedCount} categorized, ${uncategorizedCount} uncategorized)`);
      }
    }

    const hasMore = eansToFetch.length > BATCH_SIZE;
    const remaining = Math.max(0, eansToFetch.length - BATCH_SIZE);

    results.push({
      customer:      customer.seller_name,
      status:        'ok',
      fetched:       fetchedCount,
      uncategorized: uncategorizedCount,
      remaining,
      total:         allEans.length,
      has_more:      hasMore,
    });

    // 6. Self-trigger next batch if more EANs remain
    if (hasMore) {
      console.log(`[sync-categories] ${remaining} EANs still need categories for ${customer.seller_name} – triggering next batch`);
      const host     = (req.headers.host as string) || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';

      fetch(`${protocol}://${host}/api/bol-sync-categories`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customerId: customer.id }),
      }).catch((err: Error) => {
        console.error('[sync-categories] Self-trigger failed:', err.message);
      });
    } else {
      console.log(`[sync-categories] ✅ All categories up to date for ${customer.seller_name}`);
    }
  }

  return res.status(200).json({
    message: 'Category sync completed',
    results,
  });
}
