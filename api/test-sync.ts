/**
 * Simple test endpoint to verify deployment
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = createAdminClient();

    const { data: customers } = await supabase
      .from('bol_customers')
      .select('id, seller_name')
      .eq('active', true);

    return res.status(200).json({
      status: 'ok',
      customers: customers?.map((c) => ({ id: c.id, name: c.seller_name })) || [],
    });
  } catch (err) {
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
