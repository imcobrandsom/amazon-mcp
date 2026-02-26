-- Migration 005 — Extend bol.com schema for all new data types
-- Run this in Supabase SQL editor BEFORE deploying Phase 1+ code.

-- ── Fix bol_analyses.category CHECK constraint ────────────────────────────────
-- The original constraint only allowed ('content', 'pricing', 'inventory', 'advertising')
-- but existing code already writes 'orders'. We need to add 'returns' and 'performance'.
ALTER TABLE public.bol_analyses
  DROP CONSTRAINT IF EXISTS bol_analyses_category_check;
ALTER TABLE public.bol_analyses
  ADD CONSTRAINT bol_analyses_category_check
  CHECK (category IN ('content', 'pricing', 'inventory', 'advertising',
                      'orders', 'returns', 'performance'));

-- ── Fix bol_raw_snapshots.data_type CHECK constraint ──────────────────────────
ALTER TABLE public.bol_raw_snapshots
  DROP CONSTRAINT IF EXISTS bol_raw_snapshots_data_type_check;
ALTER TABLE public.bol_raw_snapshots
  ADD CONSTRAINT bol_raw_snapshots_data_type_check
  CHECK (data_type IN ('listings', 'inventory', 'orders', 'offer_insights',
                       'advertising', 'returns', 'performance'));

-- ── New table: bol_competitor_snapshots ───────────────────────────────────────
-- Stores per-EAN competing offer data fetched from /retailer/products/{ean}/offers
CREATE TABLE IF NOT EXISTS public.bol_competitor_snapshots (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bol_customer_id         uuid NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  ean                     text NOT NULL,
  offer_id                text,
  our_price               numeric(10,2),
  lowest_competing_price  numeric(10,2),
  buy_box_winner          boolean,
  competitor_count        integer,
  competitor_prices       jsonb,          -- [{ sellerId, price, condition, isBuyBoxWinner }]
  rating_score            numeric(3,2),
  rating_count            integer,
  fetched_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bol_competitors_customer_ean
  ON public.bol_competitor_snapshots(bol_customer_id, ean, fetched_at DESC);

ALTER TABLE public.bol_competitor_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bol_competitors_select" ON public.bol_competitor_snapshots
  FOR SELECT TO authenticated USING (true);

-- ── New table: bol_keyword_rankings ───────────────────────────────────────────
-- Stores per-EAN search/browse rank history from /retailer/insights/product-ranks
CREATE TABLE IF NOT EXISTS public.bol_keyword_rankings (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bol_customer_id  uuid NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  ean              text NOT NULL,
  search_type      text NOT NULL CHECK (search_type IN ('SEARCH', 'BROWSE')),
  rank             integer,
  impressions      integer,
  week_of          timestamptz NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bol_keywords_customer_ean
  ON public.bol_keyword_rankings(bol_customer_id, ean, week_of DESC);

ALTER TABLE public.bol_keyword_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bol_keywords_select" ON public.bol_keyword_rankings
  FOR SELECT TO authenticated USING (true);
