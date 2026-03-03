-- DEBUG QUERIES voor Competitor Research Data
-- Voer deze uit in Supabase SQL Editor om te checken waarom de UI leeg is

-- ============================================================
-- 1. Check of er überhaupt competitor data is
-- ============================================================

-- A. Check bol_competitor_snapshots (basis data van Extended Sync)
SELECT
  COUNT(*) as total_snapshots,
  COUNT(DISTINCT ean) as unique_eans,
  MAX(fetched_at) as last_snapshot
FROM bol_competitor_snapshots
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
-- Verwacht: > 0 rows

-- B. Check bol_product_categories (moet gevuld zijn na nieuwe sync)
SELECT
  COUNT(*) as total_products,
  COUNT(*) FILTER (WHERE category_id IS NOT NULL) as with_category_id,
  COUNT(*) FILTER (WHERE category_name IS NOT NULL) as with_category_name,
  COUNT(DISTINCT category_id) as unique_categories
FROM bol_product_categories
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
-- Verwacht: with_category_id > 0 (na nieuwe sync)

-- C. Check bol_competitor_catalog (moet gevuld zijn na nieuwe sync)
SELECT
  COUNT(*) as total_competitors,
  COUNT(DISTINCT competitor_ean) as unique_eans,
  COUNT(DISTINCT category_slug) as unique_categories,
  COUNT(*) FILTER (WHERE title IS NOT NULL) as with_title,
  MAX(fetched_at) as last_fetch
FROM bol_competitor_catalog
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
-- Verwacht: > 0 rows na sync

-- D. Check bol_category_insights (hier haalt de UI data uit)
SELECT
  category_slug,
  category_id,
  your_product_count,
  competitor_count,
  total_products,
  generated_at
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY generated_at DESC
LIMIT 5;
-- Dit is wat de UI toont!

-- ============================================================
-- 2. Check welke API endpoint data retourneert
-- ============================================================

-- Simuleer wat /api/bol-competitors API zou moeten retourneren
-- (dit is NIET de echte endpoint, maar test de data)

SELECT
  cc.id,
  cc.bol_customer_id,
  cc.category_slug,
  cc.category_id,
  cc.competitor_ean,
  cc.title,
  cc.description,
  cc.brand,
  cc.list_price,
  cc.is_customer_product,
  cc.relevance_score,
  cc.attributes,
  cc.fetched_at,
  -- Analysis data (LEFT JOIN want kan null zijn)
  json_build_object(
    'id', ca.id,
    'title_score', ca.title_score,
    'title_length', ca.title_length,
    'description_score', ca.description_score,
    'description_length', ca.description_length,
    'extracted_keywords', ca.extracted_keywords,
    'extracted_usps', ca.extracted_usps,
    'content_quality', ca.content_quality,
    'analyzed_at', ca.analyzed_at
  ) as analysis
FROM bol_competitor_catalog cc
LEFT JOIN bol_competitor_content_analysis ca
  ON ca.bol_customer_id = cc.bol_customer_id
  AND ca.competitor_ean = cc.competitor_ean
  AND ca.category_slug = cc.category_slug
WHERE cc.bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY cc.fetched_at DESC
LIMIT 10;
-- Als dit leeg is, dan is het probleem dat catalog tabel leeg is

-- ============================================================
-- 3. Check API endpoints die de UI aanroept
-- ============================================================

-- A. getBolCategoryInsights equivalent
SELECT * FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY generated_at DESC
LIMIT 1;
-- Als dit leeg is → UI toont "No competitor data available yet"

-- B. getBolCompetitorCatalog equivalent (voor specifieke categorie)
-- Eerst: welke category_slug bestaat er?
SELECT DISTINCT category_slug
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY category_slug;

-- Test met eerste categorie (vervang 'CATEGORY_SLUG' met echte waarde hierboven):
-- SELECT * FROM bol_competitor_catalog
-- WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
--   AND category_slug = 'CATEGORY_SLUG'
-- LIMIT 10;

-- ============================================================
-- 4. Check of nieuwe sync wel gedraaid heeft
-- ============================================================

-- Check timestamps van laatste activiteit
SELECT
  'competitor_snapshots' as table_name,
  MAX(fetched_at) as last_activity
FROM bol_competitor_snapshots
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'

UNION ALL

SELECT
  'product_categories' as table_name,
  MAX(fetched_at) as last_activity
FROM bol_product_categories
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'

UNION ALL

SELECT
  'competitor_catalog' as table_name,
  MAX(fetched_at) as last_activity
FROM bol_competitor_catalog
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'

UNION ALL

SELECT
  'category_insights' as table_name,
  MAX(generated_at) as last_activity
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'

ORDER BY last_activity DESC NULLS LAST;

-- Als competitor_catalog en category_insights NULL of oud zijn,
-- dan heeft de nieuwe sync niet gedraaid

-- ============================================================
-- 5. DIAGNOSE: Waarom is UI leeg?
-- ============================================================

-- Check 1: Heeft Extended Sync wel data?
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '❌ Extended Sync heeft GEEN data - run eerst Extended Sync'
    WHEN COUNT(*) > 0 THEN '✅ Extended Sync heeft ' || COUNT(*) || ' snapshots'
  END as diagnosis
FROM bol_competitor_snapshots
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- Check 2: Heeft Competitor Analysis Sync gedraaid?
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '❌ Competitor Analysis Sync heeft NIET gedraaid - trigger handmatig'
    WHEN COUNT(*) > 0 THEN '✅ Competitor Analysis heeft ' || COUNT(*) || ' insights gegenereerd'
  END as diagnosis
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- Check 3: Is er data in de catalog?
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '❌ Competitor Catalog is LEEG - sync is mislukt of niet compleet'
    WHEN COUNT(*) > 0 THEN '✅ Competitor Catalog heeft ' || COUNT(*) || ' producten'
  END as diagnosis
FROM bol_competitor_catalog
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- ============================================================
-- 6. QUICK FIX: Als data er WEL is maar UI niet werkt
-- ============================================================

-- Test of frontend API calls goed zijn geïmplementeerd
-- Controleer of deze query WEL resultaten geeft:

SELECT
  ci.category_slug,
  ci.competitor_count,
  ci.total_products,
  COUNT(cc.id) as actual_catalog_count
FROM bol_category_insights ci
LEFT JOIN bol_competitor_catalog cc
  ON cc.bol_customer_id = ci.bol_customer_id
  AND cc.category_slug = ci.category_slug
WHERE ci.bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
GROUP BY ci.category_slug, ci.competitor_count, ci.total_products
ORDER BY ci.generated_at DESC;

-- Als competitor_count > 0 MAAR actual_catalog_count = 0,
-- dan is er een mismatch tussen insights en catalog data!
