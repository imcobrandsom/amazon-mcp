-- ============================================================
-- Bol.com Advertising Historical Backfill Tracking
-- Run this in Supabase SQL Editor (Project: Follo Marketplace)
-- ============================================================

-- ============================================================
-- TABLE: bol_advertising_backfill_status
-- Tracks whether historical advertising data backfill has been completed per customer
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bol_advertising_backfill_status (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bol_customer_id     uuid NOT NULL REFERENCES public.bol_customers(id) ON DELETE CASCADE UNIQUE,
  backfill_completed  boolean NOT NULL DEFAULT false,
  oldest_date_fetched date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bol_ads_backfill_customer
  ON public.bol_advertising_backfill_status(bol_customer_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.bol_advertising_backfill_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bol_ads_backfill_select" ON public.bol_advertising_backfill_status
  FOR SELECT TO authenticated USING (true);
