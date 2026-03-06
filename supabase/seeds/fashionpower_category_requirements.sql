-- ============================================================
-- Seed data: Category attribute requirements for FashionPower
-- Run this AFTER the main migration (016_bol_content_intelligence.sql)
-- ============================================================

-- Get FashionPower customer ID
DO $$
DECLARE
  fashion_power_id uuid;
BEGIN
  -- Find FashionPower customer ID (adjust WHERE clause if needed)
  SELECT id INTO fashion_power_id
  FROM bol_customers
  WHERE seller_name ILIKE '%fashion%power%'
     OR id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'::uuid  -- Known ID from CLAUDE.md
  LIMIT 1;

  IF fashion_power_id IS NULL THEN
    RAISE NOTICE 'FashionPower customer not found, skipping seed data';
    RETURN;
  END IF;

  RAISE NOTICE 'FashionPower customer ID: %', fashion_power_id;

  -- ============================================================
  -- Sport > Sportkleding (Sportlegging, Sportshirts, etc.)
  -- ============================================================
  INSERT INTO bol_category_attribute_requirements (
    bol_customer_id,
    category_slug,
    category_name,
    required_attributes,
    recommended_attributes,
    scoring_weights,
    title_min_length,
    title_max_length,
    description_min_length
  ) VALUES (
    fashion_power_id,
    'sportkleding',
    'Sportkleding',
    ARRAY['Colour', 'Size Clothing', 'Material', 'Gender', 'Type of Sport'],
    ARRAY['Fit Form', 'Clothing Length Indication', 'Pattern', 'Washing Instructions', 'Options for Sports Clothing'],
    jsonb_build_object(
      'Title', 30,
      'Description', 25,
      'Colour', 10,
      'Size Clothing', 15,
      'Material', 10,
      'Gender', 5,
      'Type of Sport', 5
    ),
    50,   -- min title length
    150,  -- max title length
    250   -- min description length
  )
  ON CONFLICT (bol_customer_id, category_slug) DO UPDATE SET
    required_attributes = EXCLUDED.required_attributes,
    recommended_attributes = EXCLUDED.recommended_attributes,
    scoring_weights = EXCLUDED.scoring_weights,
    updated_at = now();

  -- ============================================================
  -- Sportlegging (specific sub-category)
  -- ============================================================
  INSERT INTO bol_category_attribute_requirements (
    bol_customer_id,
    category_slug,
    category_name,
    required_attributes,
    recommended_attributes,
    scoring_weights,
    title_min_length,
    title_max_length,
    description_min_length
  ) VALUES (
    fashion_power_id,
    'sportlegging',
    'Sportlegging',
    ARRAY['Colour', 'Size Clothing', 'Material', 'Gender', 'Type of Sport', 'Fit Form'],
    ARRAY['Clothing Length Indication', 'Pattern', 'Washing Instructions', 'Options for Sports Clothing', 'Size Advice'],
    jsonb_build_object(
      'Title', 30,
      'Description', 25,
      'Colour', 12,
      'Size Clothing', 15,
      'Material', 8,
      'Gender', 5,
      'Fit Form', 5
    ),
    55,
    150,
    300
  )
  ON CONFLICT (bol_customer_id, category_slug) DO UPDATE SET
    required_attributes = EXCLUDED.required_attributes,
    recommended_attributes = EXCLUDED.recommended_attributes,
    scoring_weights = EXCLUDED.scoring_weights,
    updated_at = now();

  -- ============================================================
  -- Sportshirts & Tops
  -- ============================================================
  INSERT INTO bol_category_attribute_requirements (
    bol_customer_id,
    category_slug,
    category_name,
    required_attributes,
    recommended_attributes,
    scoring_weights,
    title_min_length,
    title_max_length,
    description_min_length
  ) VALUES (
    fashion_power_id,
    'sportshirts-tops',
    'Sportshirts & Tops',
    ARRAY['Colour', 'Size Clothing', 'Material', 'Gender', 'Type of Sport'],
    ARRAY['Fit Form', 'Clothing Length Indication', 'Pattern', 'Washing Instructions'],
    jsonb_build_object(
      'Title', 30,
      'Description', 25,
      'Colour', 12,
      'Size Clothing', 15,
      'Material', 8,
      'Gender', 5,
      'Type of Sport', 5
    ),
    50,
    150,
    250
  )
  ON CONFLICT (bol_customer_id, category_slug) DO UPDATE SET
    required_attributes = EXCLUDED.required_attributes,
    recommended_attributes = EXCLUDED.recommended_attributes,
    scoring_weights = EXCLUDED.scoring_weights,
    updated_at = now();

  -- ============================================================
  -- Sport BH's
  -- ============================================================
  INSERT INTO bol_category_attribute_requirements (
    bol_customer_id,
    category_slug,
    category_name,
    required_attributes,
    recommended_attributes,
    scoring_weights,
    title_min_length,
    title_max_length,
    description_min_length
  ) VALUES (
    fashion_power_id,
    'sport-bhs',
    'Sport BH''s',
    ARRAY['Colour', 'Size Clothing', 'Material', 'Type of Sport', 'Options for Sports Clothing'],
    ARRAY['Pattern', 'Washing Instructions', 'Size Advice', 'Target Audience'],
    jsonb_build_object(
      'Title', 30,
      'Description', 25,
      'Colour', 12,
      'Size Clothing', 18,
      'Material', 8,
      'Options for Sports Clothing', 7
    ),
    50,
    150,
    300
  )
  ON CONFLICT (bol_customer_id, category_slug) DO UPDATE SET
    required_attributes = EXCLUDED.required_attributes,
    recommended_attributes = EXCLUDED.recommended_attributes,
    scoring_weights = EXCLUDED.scoring_weights,
    updated_at = now();

  -- ============================================================
  -- Sportbroeken & Shorts
  -- ============================================================
  INSERT INTO bol_category_attribute_requirements (
    bol_customer_id,
    category_slug,
    category_name,
    required_attributes,
    recommended_attributes,
    scoring_weights,
    title_min_length,
    title_max_length,
    description_min_length
  ) VALUES (
    fashion_power_id,
    'sportbroeken-shorts',
    'Sportbroeken & Shorts',
    ARRAY['Colour', 'Size Clothing', 'Material', 'Gender', 'Type of Sport'],
    ARRAY['Fit Form', 'Clothing Length Indication', 'Pattern', 'Washing Instructions'],
    jsonb_build_object(
      'Title', 30,
      'Description', 25,
      'Colour', 12,
      'Size Clothing', 15,
      'Material', 8,
      'Gender', 5,
      'Clothing Length Indication', 5
    ),
    50,
    150,
    250
  )
  ON CONFLICT (bol_customer_id, category_slug) DO UPDATE SET
    required_attributes = EXCLUDED.required_attributes,
    recommended_attributes = EXCLUDED.recommended_attributes,
    scoring_weights = EXCLUDED.scoring_weights,
    updated_at = now();

  RAISE NOTICE 'Successfully seeded % category requirements for FashionPower', 5;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error seeding FashionPower categories: %', SQLERRM;
END $$;
