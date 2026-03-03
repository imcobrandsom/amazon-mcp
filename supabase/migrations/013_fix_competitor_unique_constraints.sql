-- Migration 013: Fix missing UNIQUE constraints on competitor research tables
-- These constraints are required for UPSERT (ON CONFLICT DO UPDATE) to work correctly.
-- Without them, PostgreSQL errors silently and no data is ever written.

-- ── 1. Dedupliceer bol_competitor_catalog ──────────────────────────────────
-- Behoud per (bol_customer_id, competitor_ean, category_slug) alleen de rij met
-- de meest recente fetched_at. Gebruik de uuid primary key om te vergelijken.

DELETE FROM public.bol_competitor_catalog
WHERE id NOT IN (
  SELECT DISTINCT ON (bol_customer_id, competitor_ean, category_slug) id
  FROM public.bol_competitor_catalog
  ORDER BY bol_customer_id, competitor_ean, category_slug, fetched_at DESC NULLS LAST
);

-- ── 2. Voeg UNIQUE constraint toe aan bol_competitor_catalog ───────────────
ALTER TABLE public.bol_competitor_catalog
  ADD CONSTRAINT bol_competitor_catalog_unique
  UNIQUE (bol_customer_id, competitor_ean, category_slug);

-- ── 3. Dedupliceer bol_competitor_content_analysis ────────────────────────
-- Behoud per (bol_customer_id, competitor_ean, category_slug) alleen de rij met
-- de meest recente analyzed_at.

DELETE FROM public.bol_competitor_content_analysis
WHERE id NOT IN (
  SELECT DISTINCT ON (bol_customer_id, competitor_ean, category_slug) id
  FROM public.bol_competitor_content_analysis
  ORDER BY bol_customer_id, competitor_ean, category_slug, analyzed_at DESC NULLS LAST
);

-- ── 4. Voeg UNIQUE constraint toe aan bol_competitor_content_analysis ──────
ALTER TABLE public.bol_competitor_content_analysis
  ADD CONSTRAINT bol_competitor_content_analysis_unique
  UNIQUE (bol_customer_id, competitor_ean, category_slug);
