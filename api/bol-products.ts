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

  const [invResult, allListResults, metadataResult] = await Promise.all([
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
      return {
        ean:            item.ean,
        bsku:           item.bsku ?? null,
        title:          item.title ?? null,
        description:    item.description ?? null,  // Include description
        gradedStock:    item.gradedStock ?? 0,
        regularStock:   item.regularStock ?? 0,
        offerId:        offer?.offerId ?? null,
        price:          offer?.bundlePricesPrice ? parseFloat(offer.bundlePricesPrice) : null,
        fulfilmentType: (offer?.fulfilmentType as 'FBB' | 'FBR' | null) ?? null,
        stockAmount:    offer?.stockAmount ? parseInt(offer.stockAmount, 10) : null,
        onHold:         offer?.onHoldByRetailer === 'true',
        eol:            metadataByEan.get(item.ean) ?? false,
      };
    })
    .filter(p => p.regularStock > 0 || p.gradedStock > 0); // Exclude zero-stock products

  return res.status(200).json({ products });
}
