/**
 * Check if catalog_attributes column exists in bol_raw_snapshots
 * GET /api/test-table-schema
 */

import type { VercelRequest, VercelResponse} from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  try {
    // Try to select catalog_attributes column specifically
    const { data, error } = await supabase
      .from('bol_raw_snapshots')
      .select('id, data_type, catalog_attributes')
      .limit(1);

    if (error) {
      return res.status(500).json({
        error: error.message,
        hint: 'catalog_attributes column might not exist',
        details: error,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'catalog_attributes column exists',
      sample: data?.[0] ?? null,
    });

  } catch (err) {
    console.error('[test-table-schema] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
