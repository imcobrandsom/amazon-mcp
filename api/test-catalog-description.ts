/**
 * Test endpoint: check if catalog API has description field
 * GET /api/test-catalog-description?ean=8720246504583
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';
import { getBolToken, getCatalogProduct } from './_lib/bol-api-client.js.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const testEan = (req.query.ean as string) || '8720246504583';
    const supabase = createAdminClient();

    // Get Fashion Power customer
    const { data: customer } = await supabase
      .from('bol_customers')
      .select('*')
      .eq('id', FASHIONPOWER_ID)
      .single();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const token = await getBolToken(customer.bol_client_id as string, customer.bol_client_secret as string);

    console.log(`[test-catalog-description] Testing catalog API for EAN: ${testEan}`);

    const catalog = await getCatalogProduct(token, testEan);

    if (!catalog) {
      return res.status(404).json({
        error: 'No catalog data found for this EAN',
        ean: testEan,
      });
    }

    return res.status(200).json({
      ean: testEan,
      catalog_keys: Object.keys(catalog as Record<string, unknown>),
      catalog_sample: catalog,
      has_description: 'description' in (catalog as Record<string, unknown>),
      has_longDescription: 'longDescription' in (catalog as Record<string, unknown>),
      has_shortDescription: 'shortDescription' in (catalog as Record<string, unknown>),
    });
  } catch (err) {
    console.error('[test-catalog-description] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
