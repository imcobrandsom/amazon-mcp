-- Add catalog_attributes column to bol_raw_snapshots for storing full catalog data per product
-- This includes description, title, and all other product attributes from the Catalog API

ALTER TABLE bol_raw_snapshots
ADD COLUMN IF NOT EXISTS catalog_attributes JSONB DEFAULT NULL;

-- Create index for faster queries on catalog attributes
CREATE INDEX IF NOT EXISTS idx_bol_raw_snapshots_catalog_attrs
ON bol_raw_snapshots USING gin(catalog_attributes);

-- Add comment
COMMENT ON COLUMN bol_raw_snapshots.catalog_attributes IS
'Full catalog product attributes from /retailer/content/catalog-products/{ean} - includes Description, Title, and all other product metadata';
