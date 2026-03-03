-- Debug: Check competitor sync status

-- 1. Check category IDs (should be 5-digit catalog IDs now)
SELECT
  category_id,
  category_name,
  category_path,
  COUNT(*) as product_count
FROM bol_product_categories
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
GROUP BY category_id, category_name, category_path
ORDER BY product_count DESC;

-- 2. Check competitor catalog table
SELECT COUNT(*) as total_rows
FROM bol_competitor_catalog
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- 3. Check category insights
SELECT
  category_id,
  category_name,
  competitor_count,
  avg_price,
  created_at
FROM bol_category_insights
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY created_at DESC;

-- 4. Check recent sync jobs for competitor analysis
SELECT
  id,
  sync_type,
  status,
  created_at,
  completed_at,
  error
FROM bol_sync_jobs
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
  AND sync_type = 'competitor-analysis'
ORDER BY created_at DESC
LIMIT 5;

-- 5. Sample a few category IDs to see if they're valid catalog IDs
SELECT DISTINCT category_id
FROM bol_product_categories
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
LIMIT 5;
