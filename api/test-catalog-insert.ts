/**
 * Test if we can insert catalog data
 * POST /api/test-catalog-insert
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';

const FASHIONPOWER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
const TEST_EAN = '9999999999999';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  try {
    // Try to insert a test catalog record
    const { data: inserted, error: insertError } = await supabase
      .from('bol_raw_snapshots')
      .insert({
        bol_customer_id: FASHIONPOWER_ID,
        data_type: 'catalog',
        raw_data: { ean: TEST_EAN, catalog: { test: true } },
        catalog_attributes: { Description: 'Test description', _test: true },
        record_count: 1,
        quality_score: 1.0,
      })
      .select();

    if (insertError) {
      return res.status(500).json({
        error: 'Insert failed',
        details: insertError,
      });
    }

    // Try to read it back
    const { data: readBack, error: readError } = await supabase
      .from('bol_raw_snapshots')
      .select('*')
      .eq('bol_customer_id', FASHIONPOWER_ID)
      .eq('data_type', 'catalog')
      .limit(1);

    if (readError) {
      return res.status(500).json({
        error: 'Read failed',
        details: readError,
      });
    }

    // Clean up test data
    if (inserted && inserted.length > 0) {
      await supabase
        .from('bol_raw_snapshots')
        .delete()
        .eq('id', inserted[0].id);
    }

    return res.status(200).json({
      success: true,
      inserted: inserted,
      read_back: readBack,
      message: 'Insert and read successful - catalog sync should work',
    });

  } catch (err) {
    console.error('[test-catalog-insert] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
