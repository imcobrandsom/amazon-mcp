/**
 * Test endpoint to check Bol.com catalog API response
 * GET /api/test-catalog-api
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getBolToken, getCatalogProduct } from './_lib/bol-api-client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = createAdminClient();

    // Get Fashion Power customer
    const { data: customer } = await supabase
      .from('bol_customers')
      .select('*')
      .eq('id', 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8')
      .single();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);

    // Get first EAN from listings
    const { data: snapshot } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customer.id)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    const offers = (snapshot?.raw_data as any)?.offers || [];
    const testEan = offers[0]?.ean || offers[0]?.EAN;

    if (!testEan) {
      return res.status(400).json({ error: 'No EAN found in listings' });
    }

    console.log(`[test-catalog-api] Testing with EAN: ${testEan}`);

    // Fetch catalog data
    const catalog = await getCatalogProduct(token, testEan);

    return res.status(200).json({
      ean: testEan,
      catalog,
      catalog_type: typeof catalog,
      catalog_keys: catalog ? Object.keys(catalog) : [],
    });
  } catch (err) {
    console.error('[test-catalog-api] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
