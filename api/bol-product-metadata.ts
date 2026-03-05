/**
 * PATCH /api/bol-product-metadata
 * Toggle EOL status for a product
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });

  const { customerId, ean, eol } = req.body;
  if (!customerId || !ean || typeof eol !== 'boolean') {
    return res.status(400).json({ error: 'customerId, ean, and eol (boolean) required' });
  }

  const supabase = createAdminClient();

  // Upsert metadata record
  const { data, error } = await supabase
    .from('bol_product_metadata')
    .upsert({
      bol_customer_id: customerId,
      ean,
      eol,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'bol_customer_id,ean',
    })
    .select()
    .single();

  if (error) {
    console.error('Error updating product metadata:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, data });
}
