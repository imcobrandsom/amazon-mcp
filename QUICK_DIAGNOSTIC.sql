-- QUICK DIAGNOSTIC voor Competitor Research UI
-- Voer uit in Supabase SQL Editor

SET search_path TO public;

-- ============================================================
-- STAP 1: Is er BASIS data? (van Extended Sync)
-- ============================================================

DO $$
DECLARE
  snapshot_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO snapshot_count
  FROM bol_competitor_snapshots
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  IF snapshot_count = 0 THEN
    RAISE NOTICE '❌ PROBLEEM: Geen competitor snapshots gevonden!';
    RAISE NOTICE '   → Oplossing: Run eerst Extended Sync via dashboard';
  ELSE
    RAISE NOTICE '✅ Extended Sync data OK: % snapshots gevonden', snapshot_count;
  END IF;
END $$;

-- ============================================================
-- STAP 2: Heeft de NIEUWE competitor sync gedraaid?
-- ============================================================

DO $$
DECLARE
  catalog_count INTEGER;
  insights_count INTEGER;
  categories_count INTEGER;
BEGIN
  -- Check bol_competitor_catalog
  SELECT COUNT(*) INTO catalog_count
  FROM bol_competitor_catalog
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  -- Check bol_category_insights
  SELECT COUNT(*) INTO insights_count
  FROM bol_category_insights
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  -- Check bol_product_categories met category_id
  SELECT COUNT(*) INTO categories_count
  FROM bol_product_categories
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
    AND category_id IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE '=== NIEUWE SYNC STATUS ===';

  IF categories_count = 0 THEN
    RAISE NOTICE '❌ Product categories NIET gevuld (category_id is NULL)';
    RAISE NOTICE '   → Oplossing: Trigger competitor analysis sync handmatig';
  ELSE
    RAISE NOTICE '✅ Product categories OK: % producten met category_id', categories_count;
  END IF;

  IF catalog_count = 0 THEN
    RAISE NOTICE '❌ Competitor catalog LEEG';
    RAISE NOTICE '   → Oplossing: Wacht tot sync compleet is (~10-15 min eerste run)';
  ELSE
    RAISE NOTICE '✅ Competitor catalog OK: % producten', catalog_count;
  END IF;

  IF insights_count = 0 THEN
    RAISE NOTICE '❌ Category insights LEEG - DIT IS WAAROM UI LEEG IS!';
    RAISE NOTICE '   → Oplossing: Sync is niet compleet of gefaald';
  ELSE
    RAISE NOTICE '✅ Category insights OK: % categorieën', insights_count;
  END IF;
END $$;

-- ============================================================
-- STAP 3: DETAILVIEW - Wat zit er in de database?
-- ============================================================

-- A. Product categories met officiële IDs
SELECT
  '=== PRODUCT CATEGORIES ===' as section,
  category_id,
  category_name,
  category_slug,
  COUNT(*) as product_count
FROM bol_product_categories
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
  AND category_id IS NOT NULL
GROUP BY category_id, category_name, category_slug
ORDER BY product_count DESC
LIMIT 10;

-- B. Category Insights (dit is wat de UI toont!)
SELECT
  '=== CATEGORY INSIGHTS (UI DATA) ===' as section,
  category_slug,
  category_id,
  your_product_count,
  competitor_count,
  total_products,
  avg_competitor_price,
  jsonb_array_length(trending_keywords) as keyword_count,
  generated_at
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY generated_at DESC
LIMIT 5;

-- C. Competitor Catalog (dit vult de tabel)
SELECT
  '=== COMPETITOR CATALOG ===' as section,
  category_slug,
  COUNT(*) as total_competitors,
  COUNT(DISTINCT competitor_ean) as unique_eans,
  COUNT(*) FILTER (WHERE title IS NOT NULL) as with_title,
  COUNT(*) FILTER (WHERE description IS NOT NULL) as with_description,
  MAX(fetched_at) as last_fetch
FROM bol_competitor_catalog
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
GROUP BY category_slug
ORDER BY total_competitors DESC
LIMIT 5;

-- ============================================================
-- STAP 4: EXACTE DIAGNOSE
-- ============================================================

DO $$
DECLARE
  has_snapshots BOOLEAN;
  has_categories BOOLEAN;
  has_catalog BOOLEAN;
  has_insights BOOLEAN;
BEGIN
  -- Check alle voorwaarden
  SELECT COUNT(*) > 0 INTO has_snapshots
  FROM bol_competitor_snapshots
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  SELECT COUNT(*) > 0 INTO has_categories
  FROM bol_product_categories
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
    AND category_id IS NOT NULL;

  SELECT COUNT(*) > 0 INTO has_catalog
  FROM bol_competitor_catalog
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  SELECT COUNT(*) > 0 INTO has_insights
  FROM bol_category_insights
  WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

  RAISE NOTICE '';
  RAISE NOTICE '=== DIAGNOSE ===';

  -- Scenario 1: Helemaal niks
  IF NOT has_snapshots THEN
    RAISE NOTICE '❌ SCENARIO: Extended Sync is NOG NOOIT gedraaid';
    RAISE NOTICE '   OPLOSSING:';
    RAISE NOTICE '   1. Ga naar Bol Dashboard';
    RAISE NOTICE '   2. Klik "Sync" → kies "Extended Sync"';
    RAISE NOTICE '   3. Wacht ~5 minuten';
    RAISE NOTICE '   4. Run deze query opnieuw';
    RETURN;
  END IF;

  -- Scenario 2: Snapshots maar geen categories
  IF has_snapshots AND NOT has_categories THEN
    RAISE NOTICE '❌ SCENARIO: Extended Sync OK, maar Competitor Analysis NIET gedraaid';
    RAISE NOTICE '   OPLOSSING:';
    RAISE NOTICE '   Trigger handmatig via API:';
    RAISE NOTICE '   curl -X POST http://localhost:3001/api/bol-sync-competitor-analysis \';
    RAISE NOTICE '        -H "x-webhook-secret: YOUR_SECRET"';
    RAISE NOTICE '   OF: Wacht 30 min na Extended Sync (auto-trigger)';
    RETURN;
  END IF;

  -- Scenario 3: Categories maar geen catalog
  IF has_categories AND NOT has_catalog THEN
    RAISE NOTICE '⚠️ SCENARIO: Sync BEZIG maar niet compleet';
    RAISE NOTICE '   OPLOSSING: Wacht nog ~5-10 minuten en refresh';
    RETURN;
  END IF;

  -- Scenario 4: Catalog maar geen insights
  IF has_catalog AND NOT has_insights THEN
    RAISE NOTICE '⚠️ SCENARIO: Catalog OK maar insights generatie GEFAALD';
    RAISE NOTICE '   OPLOSSING: Check Vercel logs voor errors';
    RAISE NOTICE '   Mogelijk AI API error of database error bij insights insert';
    RETURN;
  END IF;

  -- Scenario 5: Alles is OK!
  IF has_insights THEN
    RAISE NOTICE '✅ SCENARIO: Data is COMPLEET!';
    RAISE NOTICE '   Als UI nog steeds leeg is:';
    RAISE NOTICE '   1. Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)';
    RAISE NOTICE '   2. Check browser console voor JS errors';
    RAISE NOTICE '   3. Check Network tab of API calls slagen';
    RAISE NOTICE '   4. Verifi\u00EBr dat je op juiste client_id bent';
  END IF;
END $$;

-- ============================================================
-- STAP 5: QUICK ACTION - Trigger sync als nodig
-- ============================================================

-- Als je zeker weet dat je de sync wilt triggeren:
-- UNCOMMENT onderstaande regels en run:

/*
SELECT
  'Trigger competitor analysis sync met dit commando:' as action,
  'curl -X POST http://localhost:3001/api/bol-sync-competitor-analysis -H "x-webhook-secret: ' ||
  COALESCE((SELECT value FROM env WHERE key = 'BOL_WEBHOOK_SECRET'), 'YOUR_SECRET') ||
  '"' as command;
*/
