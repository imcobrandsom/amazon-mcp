-- Migration 011: Bol.com Competitor Research Feature
-- Adds category-level competitive analysis with full product discovery

-- ============================================================
-- 1. Product Categories Table
-- ============================================================
-- Maps customer's products to Bol.com catalog categories
CREATE TABLE IF NOT EXISTS public.bol_product_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id   UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  ean               TEXT NOT NULL,
  category_id       TEXT, -- Bol.com categoryId from catalog API
  category_path     TEXT, -- e.g., "Sport > Sportkleding > Sportlegging"
  category_slug     TEXT NOT NULL, -- normalized slug e.g., "sportlegging"
  brand             TEXT,
  title             TEXT,
  fetched_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bol_customer_id, ean)
);

CREATE INDEX idx_product_categories_customer_category
  ON public.bol_product_categories(bol_customer_id, category_slug);

CREATE INDEX idx_product_categories_category_id
  ON public.bol_product_categories(bol_customer_id, category_id);

COMMENT ON TABLE public.bol_product_categories IS
  'Maps customer products to Bol.com categories for competitive analysis';

-- ============================================================
-- 2. Competitor Catalog Table (Time-Series)
-- ============================================================
-- Stores full catalog data for competitor products discovered via category search
CREATE TABLE IF NOT EXISTS public.bol_competitor_catalog (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id      UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug        TEXT NOT NULL,
  category_id          TEXT, -- Bol.com categoryId
  competitor_ean       TEXT NOT NULL,
  title                TEXT,
  description          TEXT,
  brand                TEXT,
  list_price           NUMERIC(10,2), -- from product list API
  is_customer_product  BOOLEAN DEFAULT false, -- true if this is also sold by the customer
  relevance_score      NUMERIC(5,2), -- relevance ranking from product search API
  attributes           JSONB, -- full product attributes from catalog
  fetched_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_competitor_catalog_customer_category
  ON public.bol_competitor_catalog(bol_customer_id, category_slug, fetched_at DESC);

CREATE INDEX idx_competitor_catalog_ean
  ON public.bol_competitor_catalog(competitor_ean, fetched_at DESC);

COMMENT ON TABLE public.bol_competitor_catalog IS
  'Time-series catalog data for all products in a category (customer + competitors)';

-- ============================================================
-- 3. Competitor Content Analysis Table (Time-Series)
-- ============================================================
-- AI-generated content quality scores and extracted insights
CREATE TABLE IF NOT EXISTS public.bol_competitor_content_analysis (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id     UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug       TEXT NOT NULL,
  competitor_ean      TEXT NOT NULL,
  title_score         INTEGER, -- 0-100 (150-175 chars optimal)
  title_length        INTEGER,
  description_score   INTEGER, -- 0-100
  description_length  INTEGER,
  extracted_keywords  TEXT[], -- ["anti-slip", "moisture-wicking", ...]
  extracted_usps      TEXT[], -- ["breathable fabric", "high waist", ...]
  content_quality     JSONB, -- detailed findings from AI
  analyzed_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_competitor_content_customer_category
  ON public.bol_competitor_content_analysis(bol_customer_id, category_slug, analyzed_at DESC);

CREATE INDEX idx_competitor_content_ean
  ON public.bol_competitor_content_analysis(competitor_ean, analyzed_at DESC);

COMMENT ON TABLE public.bol_competitor_content_analysis IS
  'AI content analysis results for competitor products';

-- ============================================================
-- 4. Category Insights Table (Aggregated)
-- ============================================================
-- Pre-computed category-level competitive intelligence
CREATE TABLE IF NOT EXISTS public.bol_category_insights (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id        UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug          TEXT NOT NULL,
  category_id            TEXT,
  category_path          TEXT NOT NULL,
  your_product_count     INTEGER, -- # of customer's products in category
  competitor_count       INTEGER, -- # of unique competitor products
  total_products         INTEGER, -- total products in category (yours + competitors)
  avg_competitor_price   NUMERIC(10,2),
  avg_your_price         NUMERIC(10,2),
  price_gap_percent      NUMERIC(5,2), -- (your avg - competitor avg) / competitor avg * 100
  top_competitors        JSONB, -- [{ean, title, price, relevance}, ...] top 20
  trending_keywords      JSONB, -- [{keyword, frequency, trend}, ...] top 30
  trending_usps          JSONB, -- [{usp, frequency, trend}, ...] top 15
  content_quality_avg    NUMERIC(5,2), -- average content score across competitors
  generated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_category_insights_unique
  ON public.bol_category_insights(bol_customer_id, category_slug, generated_at DESC);

CREATE INDEX idx_category_insights_customer
  ON public.bol_category_insights(bol_customer_id, generated_at DESC);

COMMENT ON TABLE public.bol_category_insights IS
  'Aggregated competitive intelligence per category per sync';

-- ============================================================
-- 5. Row Level Security (RLS) Policies
-- ============================================================

-- Enable RLS
ALTER TABLE public.bol_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bol_competitor_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bol_competitor_content_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bol_category_insights ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all data
CREATE POLICY "Authenticated users can view product categories"
  ON public.bol_product_categories FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view competitor catalog"
  ON public.bol_competitor_catalog FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view competitor analysis"
  ON public.bol_competitor_content_analysis FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view category insights"
  ON public.bol_category_insights FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role (API) can insert/update
CREATE POLICY "Service role can manage product categories"
  ON public.bol_product_categories FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage competitor catalog"
  ON public.bol_competitor_catalog FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage competitor analysis"
  ON public.bol_competitor_content_analysis FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage category insights"
  ON public.bol_category_insights FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
