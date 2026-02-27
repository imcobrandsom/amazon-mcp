-- Migration 009 — Add report_date columns to advertising performance tables
--
-- Problem: The bol_campaign_performance and bol_keyword_performance tables only
-- store synced_at (when we fetched the data), but not the actual date range that
-- the metrics represent. When querying for "November 1-27", we need to filter by
-- the report date, not the sync timestamp.
--
-- Solution: Add period_start_date and period_end_date columns to track the actual
-- reporting period for the metrics.

-- Add period dates to campaign performance table
ALTER TABLE public.bol_campaign_performance
  ADD COLUMN IF NOT EXISTS period_start_date date,
  ADD COLUMN IF NOT EXISTS period_end_date date;

-- Add index for efficient date range queries
CREATE INDEX IF NOT EXISTS idx_bol_camp_perf_period
  ON public.bol_campaign_performance(bol_customer_id, period_start_date, period_end_date);

-- Add period dates to keyword performance table
ALTER TABLE public.bol_keyword_performance
  ADD COLUMN IF NOT EXISTS period_start_date date,
  ADD COLUMN IF NOT EXISTS period_end_date date;

-- Add index for efficient date range queries
CREATE INDEX IF NOT EXISTS idx_bol_kw_perf_period
  ON public.bol_keyword_performance(bol_customer_id, period_start_date, period_end_date);

-- For existing rows without period dates, set them to synced_at date
-- (this is a best-effort migration for historical data)
UPDATE public.bol_campaign_performance
  SET period_start_date = synced_at::date,
      period_end_date = synced_at::date
  WHERE period_start_date IS NULL;

UPDATE public.bol_keyword_performance
  SET period_start_date = synced_at::date,
      period_end_date = synced_at::date
  WHERE period_start_date IS NULL;
