/**
 * GET /api/bol-products?customerId=<uuid>
 * Returns a per-product list by joining the latest inventory + listings raw snapshots on EAN.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

interface InvItem {
  ean: string;
  bsku: string | null;
  title: string | null;
  description?: string | null;  // Product description from inventory API
  gradedStock: number;
  regularStock: number;
}

interface ListOffer {
  ean: string;
  offerId: string | null;
  bundlePricesPrice: string | null;
  fulfilmentType: string | null;
  stockAmount: string | null;
  onHoldByRetailer: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { customerId } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId query param required' });
  }

  const supabase = createAdminClient();

  const [invResult, allListResults, metadataResult, catalogResult, categoryResult, adsResult] = await Promise.all([
    supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single(),
    // Fetch multiple listings snapshots to find the newest CSV_OFFERS snapshot
    supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(10), // Check last 10 snapshots
    supabase
      .from('bol_product_metadata')
      .select('ean, eol')
      .eq('bol_customer_id', customerId),
    // Fetch all catalog attributes snapshots
    supabase
      .from('bol_raw_snapshots')
      .select('raw_data, catalog_attributes')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog')
      .order('fetched_at', { ascending: false }),
    // Fetch category per EAN from bol_product_categories
    supabase
      .from('bol_product_categories')
      .select('ean, category_path, category_slug')
      .eq('bol_customer_id', customerId),
    // Fetch latest advertising snapshot for advertised EANs
    supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'advertising')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  // Find the newest snapshot with 'offers' array (CSV export format)
  const listResult = allListResults.data?.find(
    snap => Array.isArray((snap.raw_data as Record<string, unknown>)?.offers)
  ) ?? { raw_data: { offers: [] } };

  const invItems: InvItem[]     = ((invResult.data?.raw_data as Record<string, unknown>)?.items  as InvItem[])  ?? [];
  const listOffers: ListOffer[] = ((listResult.raw_data as Record<string, unknown>)?.offers as ListOffer[]) ?? [];

  // Index listings by EAN for O(1) join
  const listByEan = new Map(listOffers.map(o => [o.ean, o]));

  // Index metadata by EAN for O(1) lookup
  const metadataByEan = new Map(
    (metadataResult.data ?? []).map(m => [m.ean, m.eol])
  );

  // Index catalog attributes by EAN for O(1) lookup
  const catalogByEan = new Map(
    (catalogResult.data ?? []).map(snap => {
      const rawData = snap.raw_data as Record<string, unknown>;
      const ean = rawData.ean as string;
      return [ean, snap.catalog_attributes];
    })
  );

  // Index category by EAN: prefer leaf of category_path, fallback to category_slug
  const categoryByEan = new Map(
    (categoryResult.data ?? []).map(row => {
      const leaf = row.category_path
        ? row.category_path.split(' > ').pop() ?? row.category_slug
        : row.category_slug;
      return [row.ean, leaf as string];
    })
  );

  // Build advertised EANs set from latest advertising snapshot
  const adsRaw = adsResult.data?.raw_data as Record<string, unknown> | undefined;
  const advertisedEans = new Set<string>(
    Array.isArray(adsRaw?.advertisedEans) ? (adsRaw.advertisedEans as string[]) : []
  );

  // Deduplicate by EAN: keep first occurrence of each EAN
  const seenEans = new Set<string>();
  const deduplicatedItems = invItems.filter(item => {
    if (seenEans.has(item.ean)) return false;
    seenEans.add(item.ean);
    return true;
  });

  const products = deduplicatedItems
    .map(item => {
      const offer = listByEan.get(item.ean);
      const catalog = catalogByEan.get(item.ean) as Record<string, unknown> | undefined;

      return {
        ean:            item.ean,
        bsku:           item.bsku ?? null,
        title:          item.title ?? null,
        description:    (catalog?.Description as string) ?? null,  // From catalog attributes
        gradedStock:    item.gradedStock ?? 0,
        regularStock:   item.regularStock ?? 0,
        offerId:        offer?.offerId ?? null,
        price:          offer?.bundlePricesPrice ? parseFloat(offer.bundlePricesPrice) : null,
        fulfilmentType: (offer?.fulfilmentType as 'FBB' | 'FBR' | null) ?? null,
        stockAmount:    offer?.stockAmount ? parseInt(offer.stockAmount, 10) : null,
        onHold:         offer?.onHoldByRetailer === 'true',
        eol:            metadataByEan.get(item.ean) ?? false,
        category:       categoryByEan.get(item.ean) ?? null,
        advertised:     advertisedEans.has(item.ean),
        catalogAttributes: catalog ?? null,  // Include all catalog attributes
      };
    })
    .filter(p => p.regularStock > 0 || p.gradedStock > 0); // Exclude zero-stock products

  return res.status(200).json({ products });
}
