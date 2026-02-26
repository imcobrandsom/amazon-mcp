-- Migration 006 — Bol.com advertising time-series tables
-- Run this in Supabase SQL editor before deploying the updated sync code.
--
-- Adds two flat tables that accumulate one row per campaign/keyword per sync,
-- enabling trending charts (ROAS week-over-week, spend per campaign over time, etc.)
-- These complement bol_analyses (which keeps the AI-generated summary blob).

-- ── Table: bol_campaign_performance ──────────────────────────────────────────
-- One row per campaign per sync run. Tracks spend, revenue, ROAS, ACOS etc.
CREATE TABLE IF NOT EXISTS public.bol_campaign_performance (
  id               uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  bol_customer_id  uuid         NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  campaign_id      text         NOT NULL,
  campaign_name    text,
  campaign_type    text,          -- MANUAL | AUTOMATIC
  state            text,          -- ENABLED | PAUSED | ARCHIVED
  budget           numeric(12,4), -- daily budget (EUR)
  spend            numeric(12,4), -- total cost in period
  impressions      integer,
  clicks           integer,
  ctr_pct          numeric(8,4),  -- click-through rate
  avg_cpc          numeric(8,4),  -- average cost per click
  revenue          numeric(12,4), -- attributed sales (14-day window)
  roas             numeric(8,4),  -- return on ad spend
  acos             numeric(8,4),  -- ad cost of sales
  conversions      integer,       -- orders within 14-day attribution
  cvr_pct          numeric(8,4),  -- conversion rate
  synced_at        timestamptz  NOT NULL DEFAULT now()
);

-- Fast lookups for trend charts
CREATE INDEX IF NOT EXISTS idx_bol_camp_perf_customer_time
  ON public.bol_campaign_performance(bol_customer_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_bol_camp_perf_campaign_time
  ON public.bol_campaign_performance(bol_customer_id, campaign_id, synced_at DESC);

ALTER TABLE public.bol_campaign_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bol_camp_perf_select" ON public.bol_campaign_performance
  FOR SELECT TO authenticated USING (true);

-- ── Table: bol_keyword_performance ───────────────────────────────────────────
-- One row per keyword per sync run. Tracks spend, ACOS, conversions per keyword.
CREATE TABLE IF NOT EXISTS public.bol_keyword_performance (
  id               uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  bol_customer_id  uuid         NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE,
  keyword_id       text         NOT NULL,
  keyword_text     text,
  match_type       text,          -- EXACT | PHRASE
  campaign_id      text         NOT NULL,
  ad_group_id      text,
  bid              numeric(8,4),  -- current keyword bid (EUR)
  state            text,          -- ENABLED | PAUSED | ARCHIVED
  spend            numeric(12,4),
  impressions      integer,
  clicks           integer,
  revenue          numeric(12,4),
  acos             numeric(8,4),
  conversions      integer,
  synced_at        timestamptz  NOT NULL DEFAULT now()
);

-- Fast lookups for keyword performance queries
CREATE INDEX IF NOT EXISTS idx_bol_kw_perf_customer_time
  ON public.bol_keyword_performance(bol_customer_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_bol_kw_perf_keyword_time
  ON public.bol_keyword_performance(bol_customer_id, keyword_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_bol_kw_perf_campaign
  ON public.bol_keyword_performance(bol_customer_id, campaign_id, synced_at DESC);

ALTER TABLE public.bol_keyword_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bol_kw_perf_select" ON public.bol_keyword_performance
  FOR SELECT TO authenticated USING (true);
