-- ============================================================
-- Helper migration: Update advertising snapshots with advertised EANs
-- This ensures the 'advertised' column in bol_products works correctly
-- Run this AFTER populating keywords from advertising data
-- ============================================================

-- ============================================================
-- FUNCTION: Rebuild advertising snapshot with EAN list
-- Call this after running /api/bol-keywords-populate
-- ============================================================
CREATE OR REPLACE FUNCTION rebuild_advertising_snapshot(p_customer_id uuid)
RETURNS void AS $$
DECLARE
  advertised_eans text[];
BEGIN
  -- Collect all unique EANs that have keywords from advertising source
  SELECT ARRAY_AGG(DISTINCT ean)
  INTO advertised_eans
  FROM bol_product_keyword_targets
  WHERE bol_customer_id = p_customer_id
    AND source = 'advertising';

  -- Insert or update the advertising snapshot
  INSERT INTO bol_raw_snapshots (
    bol_customer_id,
    data_type,
    raw_data,
    record_count,
    fetched_at
  ) VALUES (
    p_customer_id,
    'advertising',
    jsonb_build_object('advertisedEans', advertised_eans),
    COALESCE(array_length(advertised_eans, 1), 0),
    NOW()
  )
  ON CONFLICT (bol_customer_id, data_type, fetched_at)
  DO UPDATE SET
    raw_data = EXCLUDED.raw_data,
    record_count = EXCLUDED.record_count;

  RAISE NOTICE 'Updated advertising snapshot with % advertised products', COALESCE(array_length(advertised_eans, 1), 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rebuild_advertising_snapshot IS
  'Rebuilds the advertising snapshot with a list of advertised EANs from bol_product_keyword_targets. Call after keyword population.';

-- ============================================================
-- Optional: Auto-rebuild for FashionPower if keywords exist
-- ============================================================
DO $$
DECLARE
  fashion_power_id uuid;
  keyword_count integer;
BEGIN
  -- Find FashionPower customer ID
  SELECT id INTO fashion_power_id
  FROM bol_customers
  WHERE seller_name ILIKE '%fashion%power%'
     OR id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'::uuid
  LIMIT 1;

  IF fashion_power_id IS NULL THEN
    RAISE NOTICE 'FashionPower customer not found, skipping advertising snapshot rebuild';
    RETURN;
  END IF;

  -- Check if any advertising keywords exist
  SELECT COUNT(*) INTO keyword_count
  FROM bol_product_keyword_targets
  WHERE bol_customer_id = fashion_power_id
    AND source = 'advertising';

  IF keyword_count > 0 THEN
    RAISE NOTICE 'Found % advertising keywords, rebuilding snapshot...', keyword_count;
    PERFORM rebuild_advertising_snapshot(fashion_power_id);
  ELSE
    RAISE NOTICE 'No advertising keywords found yet. Run /api/bol-keywords-populate first.';
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error rebuilding advertising snapshot: %', SQLERRM;
END $$;
