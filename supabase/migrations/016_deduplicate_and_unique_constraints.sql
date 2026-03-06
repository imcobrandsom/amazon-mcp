-- Migration 016 — Deduplicate advertising tables + add unique constraints
--
-- Problem: bol-sync-start (cron) and bol-sync-trigger (manual) both use plain INSERT.
-- Without a unique constraint on (bol_customer_id, campaign_id, period_start_date),
-- every sync adds duplicate rows for the same day. This causes spend/revenue/conversions
-- to be counted multiple times in aggregated reports.
--
-- Fix:
--   1. Remove duplicate rows, keeping the most recent synced_at per (customer, campaign/keyword, date)
--   2. Add UNIQUE constraints so future syncs automatically enforce one row per day

-- ── Step 1: Remove duplicate campaign performance rows ────────────────────────
-- Keep the row with the latest synced_at for each (customer, campaign, date) triple.
DELETE FROM public.bol_campaign_performance
WHERE id NOT IN (
  SELECT DISTINCT ON (bol_customer_id, campaign_id, period_start_date) id
  FROM public.bol_campaign_performance
  ORDER BY bol_customer_id, campaign_id, period_start_date, synced_at DESC
);

-- ── Step 2: Remove duplicate keyword performance rows ─────────────────────────
DELETE FROM public.bol_keyword_performance
WHERE id NOT IN (
  SELECT DISTINCT ON (bol_customer_id, keyword_id, period_start_date) id
  FROM public.bol_keyword_performance
  ORDER BY bol_customer_id, keyword_id, period_start_date, synced_at DESC
);

-- ── Step 3: Add unique constraints ───────────────────────────────────────────
-- This enforces one row per (customer, campaign, date) going forward.
-- Syncs will now use ON CONFLICT DO UPDATE (upsert) to overwrite stale data.
ALTER TABLE public.bol_campaign_performance
  ADD CONSTRAINT uq_camp_perf_customer_campaign_date
  UNIQUE (bol_customer_id, campaign_id, period_start_date);

ALTER TABLE public.bol_keyword_performance
  ADD CONSTRAINT uq_kw_perf_customer_keyword_date
  UNIQUE (bol_customer_id, keyword_id, period_start_date);
