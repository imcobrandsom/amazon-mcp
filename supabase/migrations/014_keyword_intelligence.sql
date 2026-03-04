-- Migration 014: Keyword Intelligence
-- Keyword master list + search volume tracking (aparte tabel)

-- 1. Keyword master list (ontdubbeld per customer + keyword)
CREATE TABLE IF NOT EXISTS public.bol_keyword_master (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id     UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug       TEXT NOT NULL,
  keyword             TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('competitor_research', 'advertising', 'product_ranks')),
  is_brand_term       BOOLEAN DEFAULT false,
  backfill_complete   BOOLEAN DEFAULT false,
  last_backfill_at    TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bol_customer_id, category_slug, keyword)
);

CREATE INDEX idx_keyword_master_customer_category
  ON public.bol_keyword_master(bol_customer_id, category_slug);

CREATE INDEX idx_keyword_master_backfill_pending
  ON public.bol_keyword_master(bol_customer_id, backfill_complete)
  WHERE backfill_complete = false;

-- 2. Search volume tabel (aparte tabel, niet mixen met rankings)
CREATE TABLE IF NOT EXISTS public.bol_keyword_search_volume (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id   UUID NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  category_slug     TEXT NOT NULL,
  keyword           TEXT NOT NULL,
  search_volume     INTEGER NOT NULL,
  week_of           DATE NOT NULL,
  fetched_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bol_customer_id, keyword, week_of)
);

CREATE INDEX idx_keyword_volume_customer_keyword
  ON public.bol_keyword_search_volume(bol_customer_id, keyword, week_of DESC);

CREATE INDEX idx_keyword_volume_customer_category
  ON public.bol_keyword_search_volume(bol_customer_id, category_slug, week_of DESC);

-- 3. Voeg keyword + category_slug toe aan bestaande rankings tabel (voor product-specifieke ranks)
ALTER TABLE public.bol_keyword_rankings
  ADD COLUMN IF NOT EXISTS keyword TEXT,
  ADD COLUMN IF NOT EXISTS category_slug TEXT,
  ADD COLUMN IF NOT EXISTS category_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bol_keywords_keyword
  ON public.bol_keyword_rankings(bol_customer_id, keyword, week_of DESC);

CREATE INDEX IF NOT EXISTS idx_bol_keywords_category
  ON public.bol_keyword_rankings(bol_customer_id, category_slug, week_of DESC);

-- RLS
ALTER TABLE public.bol_keyword_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bol_keyword_search_volume ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view keyword master"
  ON public.bol_keyword_master FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage keyword master"
  ON public.bol_keyword_master FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Authenticated users can view keyword search volume"
  ON public.bol_keyword_search_volume FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage keyword search volume"
  ON public.bol_keyword_search_volume FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
