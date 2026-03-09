-- Migration: AI Keyword Extraction Progress Tracking
-- Tracks which products have been processed for AI keyword extraction

CREATE TABLE IF NOT EXISTS bol_ai_extraction_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id UUID NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,

  -- Progress tracking
  last_processed_ean TEXT,
  total_products INTEGER DEFAULT 0,
  products_processed INTEGER DEFAULT 0,
  cycle_number INTEGER DEFAULT 1,

  -- Timestamps
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(bol_customer_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_extraction_progress_customer
  ON bol_ai_extraction_progress(bol_customer_id);

-- Add comment
COMMENT ON TABLE bol_ai_extraction_progress IS
  'Tracks AI keyword extraction progress per customer. Processes 10 products per day in rotation.';
