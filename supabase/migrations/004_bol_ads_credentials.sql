-- ============================================================
-- Add bol.com Advertising API credentials to bol_customers
-- Retailer API and Advertising API use separate OAuth credentials.
-- Run this in Supabase SQL Editor after 003_bol_marketplace_schema.sql
-- ============================================================

alter table public.bol_customers
  add column if not exists ads_client_id     text,
  add column if not exists ads_client_secret text;

-- Constraint: either both ads fields are set, or neither
alter table public.bol_customers
  add constraint bol_ads_credentials_complete check (
    (ads_client_id is null and ads_client_secret is null)
    or
    (ads_client_id is not null and ads_client_secret is not null)
  );

-- Verify
-- select column_name from information_schema.columns
-- where table_name = 'bol_customers' order by ordinal_position;
