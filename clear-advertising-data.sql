-- Clear all advertising performance data for FashionPower customer
-- Run this in Supabase SQL Editor before triggering a fresh sync

-- Delete campaign performance data
DELETE FROM bol_campaign_performance
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- Delete keyword performance data
DELETE FROM bol_keyword_performance
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- Delete backfill status (so next sync does full 30-day backfill)
DELETE FROM bol_advertising_backfill_status
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

-- Verify deletion
SELECT
  (SELECT COUNT(*) FROM bol_campaign_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8') as campaign_rows,
  (SELECT COUNT(*) FROM bol_keyword_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8') as keyword_rows,
  (SELECT COUNT(*) FROM bol_advertising_backfill_status WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8') as backfill_rows;

-- Expected result: All counts should be 0
