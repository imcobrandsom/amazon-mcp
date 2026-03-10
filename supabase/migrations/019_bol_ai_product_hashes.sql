-- 019_bol_ai_product_hashes.sql
-- Track content hashes per product to enable change detection in the AI keyword cron.
-- The AI extraction is skipped for products whose title/description hasn't changed
-- since the last successful extraction, avoiding unnecessary Anthropic API calls.

CREATE TABLE IF NOT EXISTS bol_ai_product_hashes (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bol_customer_id uuid        NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  ean             text        NOT NULL,
  -- SHA-256 hash (hex) of: currentTitle|currentDescription|basisTitle|basisDescription
  content_hash    text        NOT NULL,
  last_extracted_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bol_customer_id, ean)
);

CREATE INDEX IF NOT EXISTS idx_bol_ai_product_hashes_customer
  ON bol_ai_product_hashes(bol_customer_id);

-- RLS: API routes use the service-role key so we just enable RLS and allow all.
ALTER TABLE bol_ai_product_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON bol_ai_product_hashes
  FOR ALL USING (true);
