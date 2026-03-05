/**
 * ONE-TIME migration endpoint: Add catalog_attributes column
 * POST /api/run-catalog-migration
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const supabase = createAdminClient();

  try {
    // Run the migration SQL
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add catalog_attributes column to bol_raw_snapshots for storing full catalog data per product
        ALTER TABLE bol_raw_snapshots
        ADD COLUMN IF NOT EXISTS catalog_attributes JSONB DEFAULT NULL;

        -- Create index for faster queries on catalog attributes
        CREATE INDEX IF NOT EXISTS idx_bol_raw_snapshots_catalog_attrs
        ON bol_raw_snapshots USING gin(catalog_attributes);

        -- Add comment
        COMMENT ON COLUMN bol_raw_snapshots.catalog_attributes IS
        'Full catalog product attributes from /retailer/content/catalog-products/{ean} - includes Description, Title, and all other product metadata';
      `,
    });

    if (error) {
      // If RPC doesn't exist, return instructions for manual migration
      return res.status(200).json({
        status: 'manual_migration_required',
        message: 'Please run the migration SQL manually in Supabase SQL Editor',
        sql: `
ALTER TABLE bol_raw_snapshots
ADD COLUMN IF NOT EXISTS catalog_attributes JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bol_raw_snapshots_catalog_attrs
ON bol_raw_snapshots USING gin(catalog_attributes);

COMMENT ON COLUMN bol_raw_snapshots.catalog_attributes IS
'Full catalog product attributes from /retailer/content/catalog-products/{ean} - includes Description, Title, and all other product metadata';
        `,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Migration completed successfully',
    });
  } catch (err) {
    return res.status(500).json({
      error: (err as Error).message,
    });
  }
}
