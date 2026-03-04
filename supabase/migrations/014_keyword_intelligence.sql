-- Migration 014: Keyword Intelligence
-- Keyword master list + uitgebreide rankings per zoekterm

-- 1. Keyword master list (ontdubbeld per customer + categorie)
CREATE TABLE IF NOT EXISTS public.bol_keyword_master (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id   UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug     TEXT NOT NULL,
  keyword           TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('competitor_research', 'advertising', 'product_ranks')),
  is_brand_term     BOOLEAN DEFAULT false,
  first_seen_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bol_customer_id, category_slug, keyword)
);

CREATE INDEX idx_keyword_master_customer_category
  ON public.bol_keyword_master(bol_customer_id, category_slug);

-- 2. Voeg keyword + category_slug toe aan bestaande rankings tabel
-- En maak EAN nullable (search volume data is niet EAN-specifiek)
ALTER TABLE public.bol_keyword_rankings
  ALTER COLUMN ean DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS keyword TEXT,
  ADD COLUMN IF NOT EXISTS category_slug TEXT,
  ADD COLUMN IF NOT EXISTS category_id TEXT;

-- Index voor keyword-gerichte queries
CREATE INDEX IF NOT EXISTS idx_bol_keywords_keyword
  ON public.bol_keyword_rankings(bol_customer_id, keyword, week_of DESC);

CREATE INDEX IF NOT EXISTS idx_bol_keywords_category
  ON public.bol_keyword_rankings(bol_customer_id, category_slug, week_of DESC);

-- Unique constraint voor keyword search volume (één rij per keyword per week)
-- Alleen voor rijen waar EAN NULL is (search volume entries)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bol_keywords_unique_search_volume
  ON public.bol_keyword_rankings(bol_customer_id, keyword, week_of)
  WHERE ean IS NULL;

-- 3. Backfill tracking (per customer + category_slug, net als competitor sync)
CREATE TABLE IF NOT EXISTS public.bol_keyword_backfill_status (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id   UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug     TEXT NOT NULL,
  weeks_fetched     INTEGER DEFAULT 0,  -- hoeveel weken al opgehaald
  backfill_complete BOOLEAN DEFAULT false,
  last_week_of      DATE,               -- laatste opgehaalde maandag
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bol_customer_id, category_slug)
);

-- RLS
ALTER TABLE public.bol_keyword_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bol_keyword_backfill_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view keyword master"
  ON public.bol_keyword_master FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage keyword master"
  ON public.bol_keyword_master FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Authenticated users can view keyword backfill"
  ON public.bol_keyword_backfill_status FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage keyword backfill"
  ON public.bol_keyword_backfill_status FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
