-- Migration 013: Competitor Research Fix
-- Fixes category detection, adds UNIQUE constraints, and adds missing columns

-- ============================================================
-- 1. Update bol_product_categories table
-- ============================================================

-- 1a. Add category_id and category_name columns
ALTER TABLE public.bol_product_categories
  ADD COLUMN IF NOT EXISTS category_id TEXT,
  ADD COLUMN IF NOT EXISTS category_name TEXT;

-- 1b. Add UNIQUE constraint (was missing in migration 011)
-- First remove any duplicates
DO $$
BEGIN
  DELETE FROM public.bol_product_categories a
    USING public.bol_product_categories b
    WHERE a.id > b.id
      AND a.bol_customer_id = b.bol_customer_id
      AND a.ean = b.ean;
END $$;

-- Now add the constraint
ALTER TABLE public.bol_product_categories
  DROP CONSTRAINT IF EXISTS bol_product_categories_customer_ean_unique;
ALTER TABLE public.bol_product_categories
  ADD CONSTRAINT bol_product_categories_customer_ean_unique
  UNIQUE (bol_customer_id, ean);

-- Add index on category_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_categories_category_id_name
  ON public.bol_product_categories(bol_customer_id, category_id);

-- ============================================================
-- 2. Update bol_competitor_catalog table
-- ============================================================

-- 2a. Add category_id and title_raw columns
ALTER TABLE public.bol_competitor_catalog
  ADD COLUMN IF NOT EXISTS category_id TEXT,
  ADD COLUMN IF NOT EXISTS title_raw TEXT;  -- unbewerkte titel uit /products/list

-- 2b. Remove duplicates and add UNIQUE constraint
-- First identify and remove duplicates (keep newest)
DO $$
BEGIN
  DELETE FROM public.bol_competitor_catalog a
    USING public.bol_competitor_catalog b
    WHERE a.id > b.id
      AND a.bol_customer_id = b.bol_customer_id
      AND a.competitor_ean = b.competitor_ean
      AND a.category_slug = b.category_slug;
END $$;

-- Add UNIQUE constraint
ALTER TABLE public.bol_competitor_catalog
  DROP CONSTRAINT IF EXISTS bol_competitor_catalog_unique;
ALTER TABLE public.bol_competitor_catalog
  ADD CONSTRAINT bol_competitor_catalog_unique
  UNIQUE (bol_customer_id, competitor_ean, category_slug);

-- ============================================================
-- 3. Update bol_competitor_content_analysis table
-- ============================================================

-- Remove duplicates
DO $$
BEGIN
  DELETE FROM public.bol_competitor_content_analysis a
    USING public.bol_competitor_content_analysis b
    WHERE a.id > b.id
      AND a.bol_customer_id = b.bol_customer_id
      AND a.competitor_ean = b.competitor_ean
      AND a.category_slug = b.category_slug;
END $$;

-- Add UNIQUE constraint
ALTER TABLE public.bol_competitor_content_analysis
  DROP CONSTRAINT IF EXISTS bol_competitor_content_analysis_unique;
ALTER TABLE public.bol_competitor_content_analysis
  ADD CONSTRAINT bol_competitor_content_analysis_unique
  UNIQUE (bol_customer_id, competitor_ean, category_slug);

-- ============================================================
-- 4. Update bol_category_insights table
-- ============================================================

-- Add category_id column if not exists
ALTER TABLE public.bol_category_insights
  ADD COLUMN IF NOT EXISTS category_id TEXT;

-- Trending keywords JSONB format documentation:
-- trending_keywords: [{ keyword: string, frequency: number, search_volume: number | null, trend: 'up' | 'down' | 'stable' }]

COMMENT ON COLUMN public.bol_category_insights.trending_keywords IS
  'JSONB array: [{keyword: string, frequency: number, search_volume: number | null, trend: string}]';

-- ============================================================
-- 5. Verification
-- ============================================================

-- Verify constraints are in place
DO $$
BEGIN
  -- Verify bol_product_categories UNIQUE constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bol_product_categories_customer_ean_unique'
  ) THEN
    RAISE EXCEPTION 'UNIQUE constraint missing on bol_product_categories';
  END IF;

  -- Verify bol_competitor_catalog UNIQUE constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bol_competitor_catalog_unique'
  ) THEN
    RAISE EXCEPTION 'UNIQUE constraint missing on bol_competitor_catalog';
  END IF;

  -- Verify bol_competitor_content_analysis UNIQUE constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bol_competitor_content_analysis_unique'
  ) THEN
    RAISE EXCEPTION 'UNIQUE constraint missing on bol_competitor_content_analysis';
  END IF;
END $$;

-- Migration complete
