-- ============================================================
-- Bol.com Content Intelligence — Phase 1: Keyword Targeting & Completeness
-- Foundation for autonomous content optimization agent
-- ============================================================

-- ============================================================
-- TABLE: bol_product_keyword_targets
-- Target keywords per product with priority and tracking
-- ============================================================
CREATE TABLE bol_product_keyword_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  ean text NOT NULL,
  keyword text NOT NULL,

  -- Priority and source
  priority integer NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),  -- 10 = highest
  source text NOT NULL DEFAULT 'ai_suggestion'
    CHECK (source IN ('category_analysis', 'competitor_intel', 'advertising', 'manual')),

  -- Cached metrics (updated during keyword sync)
  search_volume integer,
  current_organic_rank integer,
  target_rank integer DEFAULT 10,

  -- Content presence tracking
  in_title boolean DEFAULT false,
  in_description boolean DEFAULT false,
  keyword_density_pct numeric(5,2),  -- % of description that contains this keyword

  -- Performance tracking (last 30 days from advertising data)
  impressions_last_30d integer,
  clicks_last_30d integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(bol_customer_id, ean, keyword)
);

CREATE INDEX idx_bol_product_keyword_targets_ean
  ON bol_product_keyword_targets(bol_customer_id, ean);
CREATE INDEX idx_bol_product_keyword_targets_priority
  ON bol_product_keyword_targets(priority DESC) WHERE in_title = false;
CREATE INDEX idx_bol_product_keyword_targets_keyword
  ON bol_product_keyword_targets(bol_customer_id, keyword);

ALTER TABLE bol_product_keyword_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_product_keyword_targets FOR ALL TO authenticated USING (true);

COMMENT ON TABLE bol_product_keyword_targets IS
  'Target keywords per product for content optimization. Populated by AI analysis of category trends, competitor intel, and advertising performance.';

-- ============================================================
-- TABLE: bol_category_attribute_requirements
-- Per-category attribute requirements for completeness scoring
-- ============================================================
CREATE TABLE bol_category_attribute_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  category_slug text NOT NULL,  -- from bol_product_categories
  category_name text,

  -- Attribute rules
  required_attributes text[] NOT NULL DEFAULT '{}',
  recommended_attributes text[] DEFAULT '{}',

  -- Scoring weights for completeness calculation (JSON object with attribute names as keys)
  scoring_weights jsonb DEFAULT '{}'::jsonb,
  -- Example: {"Colour": 15, "Size Clothing": 20, "Material": 10, "Description": 25, "Title": 30}

  -- SEO rules
  title_min_length integer DEFAULT 40,
  title_max_length integer DEFAULT 150,
  description_min_length integer DEFAULT 200,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(bol_customer_id, category_slug)
);

CREATE INDEX idx_bol_category_attr_req
  ON bol_category_attribute_requirements(bol_customer_id, category_slug);

ALTER TABLE bol_category_attribute_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_category_attribute_requirements FOR ALL TO authenticated USING (true);

COMMENT ON TABLE bol_category_attribute_requirements IS
  'Defines required and recommended attributes per category for completeness scoring. Manually configured per customer.';

-- ============================================================
-- TABLE: bol_customer_settings
-- Per-customer autonomy settings and content rules
-- ============================================================
CREATE TABLE bol_customer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE UNIQUE,

  -- Autonomy level
  autonomy_level text NOT NULL DEFAULT 'manual'
    CHECK (autonomy_level IN ('manual', 'semi-auto', 'auto')),

  -- Content generation rules
  auto_approve_minor_edits boolean DEFAULT false,
  max_title_length integer DEFAULT 150,
  min_description_length integer DEFAULT 200,

  -- Keyword optimization rules
  min_keyword_volume_threshold integer DEFAULT 500,  -- Only target keywords with 500+ monthly searches
  max_keywords_per_product integer DEFAULT 10,

  -- Performance thresholds
  min_stock_for_content_work integer DEFAULT 5,

  -- n8n workflow integration (for future image enrichment)
  image_enrichment_enabled boolean DEFAULT false,
  image_enrichment_webhook_url text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bol_customer_settings_customer
  ON bol_customer_settings(bol_customer_id);

ALTER TABLE bol_customer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_customer_settings FOR ALL TO authenticated USING (true);

COMMENT ON TABLE bol_customer_settings IS
  'Per-customer configuration for autonomous content optimization agent. Controls autonomy level and content generation rules.';

-- ============================================================
-- FUNCTION: Get product completeness data
-- Returns completeness metrics for a single product
-- ============================================================
CREATE OR REPLACE FUNCTION get_product_completeness(
  p_customer_id uuid,
  p_ean text
)
RETURNS TABLE (
  ean text,
  category_slug text,
  required_filled integer,
  required_total integer,
  required_completeness_pct integer,
  recommended_filled integer,
  recommended_total integer,
  title_length integer,
  title_min_length integer,
  title_meets_min boolean,
  description_length integer,
  description_min_length integer,
  description_meets_min boolean,
  overall_completeness_score integer
) AS $$
BEGIN
  RETURN QUERY
  WITH product_data AS (
    SELECT
      pc.ean,
      pc.category_slug,
      snap.catalog_attributes,
      req.required_attributes,
      req.recommended_attributes,
      req.title_min_length,
      req.description_min_length
    FROM bol_product_categories pc
    LEFT JOIN bol_category_attribute_requirements req
      ON req.bol_customer_id = pc.bol_customer_id
      AND req.category_slug = pc.category_slug
    CROSS JOIN LATERAL (
      SELECT catalog_attributes
      FROM bol_raw_snapshots
      WHERE data_type = 'catalog'
        AND bol_customer_id = pc.bol_customer_id
        AND (raw_data->>'ean') = pc.ean
      ORDER BY fetched_at DESC
      LIMIT 1
    ) snap
    WHERE pc.bol_customer_id = p_customer_id
      AND pc.ean = p_ean
  ),
  attr_counts AS (
    SELECT
      pd.ean,
      pd.category_slug,
      pd.required_attributes,
      pd.recommended_attributes,
      pd.title_min_length,
      pd.description_min_length,

      -- Count filled required attributes
      (SELECT COUNT(*)
       FROM unnest(COALESCE(pd.required_attributes, ARRAY[]::text[])) attr
       WHERE pd.catalog_attributes ? attr
         AND COALESCE(pd.catalog_attributes->>attr, '') != ''
      ) AS req_filled,

      -- Count filled recommended attributes
      (SELECT COUNT(*)
       FROM unnest(COALESCE(pd.recommended_attributes, ARRAY[]::text[])) attr
       WHERE pd.catalog_attributes ? attr
         AND COALESCE(pd.catalog_attributes->>attr, '') != ''
      ) AS rec_filled,

      -- Title metrics
      LENGTH(COALESCE(pd.catalog_attributes->>'Title', '')) AS title_len,
      CASE
        WHEN pd.catalog_attributes->>'Title' IS NULL THEN false
        WHEN LENGTH(pd.catalog_attributes->>'Title') < COALESCE(pd.title_min_length, 40) THEN false
        ELSE true
      END AS title_ok,

      -- Description metrics
      LENGTH(COALESCE(pd.catalog_attributes->>'Description', '')) AS desc_len,
      CASE
        WHEN pd.catalog_attributes->>'Description' IS NULL THEN false
        WHEN LENGTH(pd.catalog_attributes->>'Description') < COALESCE(pd.description_min_length, 200) THEN false
        ELSE true
      END AS desc_ok

    FROM product_data pd
  )
  SELECT
    ac.ean,
    ac.category_slug,
    ac.req_filled::integer,
    array_length(ac.required_attributes, 1)::integer AS req_total,
    CASE
      WHEN array_length(ac.required_attributes, 1) > 0
      THEN ROUND(100.0 * ac.req_filled / array_length(ac.required_attributes, 1))::integer
      ELSE NULL
    END AS req_completeness_pct,
    ac.rec_filled::integer,
    array_length(ac.recommended_attributes, 1)::integer AS rec_total,
    ac.title_len::integer,
    ac.title_min_length::integer,
    ac.title_ok,
    ac.desc_len::integer,
    ac.description_min_length::integer,
    ac.desc_ok,

    -- Overall completeness score (weighted)
    CASE
      WHEN array_length(ac.required_attributes, 1) = 0 THEN NULL
      ELSE ROUND(
        (ac.req_filled::numeric / array_length(ac.required_attributes, 1) * 60) +  -- 60% weight on required
        (CASE WHEN ac.title_ok THEN 20 ELSE 0 END) +  -- 20% on title
        (CASE WHEN ac.desc_ok THEN 20 ELSE 0 END)     -- 20% on description
      )::integer
    END AS overall_score

  FROM attr_counts ac;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_product_completeness IS
  'Calculates product content completeness score based on category requirements. Used by API endpoints and priority queue.';

-- ============================================================
-- VIEW: bol_product_priority_queue
-- Autonomous agent work queue ranked by business impact
-- ============================================================
CREATE OR REPLACE VIEW bol_product_priority_queue AS
WITH product_completeness AS (
  SELECT
    pc.bol_customer_id,
    pc.ean,
    pc.category_slug,

    -- Get latest catalog data
    (SELECT catalog_attributes->>'Title'
     FROM bol_raw_snapshots
     WHERE data_type = 'catalog'
       AND bol_customer_id = pc.bol_customer_id
       AND (raw_data->>'ean') = pc.ean
     ORDER BY fetched_at DESC
     LIMIT 1
    ) AS title,

    -- Completeness score via function
    (SELECT overall_completeness_score
     FROM get_product_completeness(pc.bol_customer_id, pc.ean)
    ) AS completeness_score

  FROM bol_product_categories pc
),
product_metrics AS (
  SELECT
    pc.bol_customer_id,
    pc.ean,
    pc.title,
    pc.completeness_score,

    -- Keyword opportunity: top keyword search volume not in title
    COALESCE(
      (SELECT MAX(search_volume)
       FROM bol_product_keyword_targets kw
       WHERE kw.bol_customer_id = pc.bol_customer_id
         AND kw.ean = pc.ean
         AND kw.in_title = false
         AND kw.search_volume > 0
      ), 0
    ) AS top_missing_keyword_volume,

    -- Count of high-priority keywords not in title
    COALESCE(
      (SELECT COUNT(*)
       FROM bol_product_keyword_targets kw
       WHERE kw.bol_customer_id = pc.bol_customer_id
         AND kw.ean = pc.ean
         AND kw.in_title = false
         AND kw.priority >= 7
      ), 0
    ) AS high_priority_keywords_missing,

    -- Stock from latest inventory snapshot
    COALESCE(
      (SELECT
         COALESCE((item->>'regularStock')::integer, 0) +
         COALESCE((item->>'gradedStock')::integer, 0)
       FROM bol_raw_snapshots,
         jsonb_array_elements((raw_data->'items')::jsonb) AS item
       WHERE data_type = 'inventory'
         AND bol_customer_id = pc.bol_customer_id
         AND item->>'ean' = pc.ean
       ORDER BY fetched_at DESC
       LIMIT 1
      ), 0
    ) AS current_stock

  FROM product_completeness pc
  WHERE pc.completeness_score < 80  -- Only products needing work
)
SELECT
  ean,
  bol_customer_id,
  title,
  completeness_score,
  top_missing_keyword_volume,
  high_priority_keywords_missing,
  current_stock,

  -- Combined priority score (0-1000)
  (
    -- Keyword opportunity (0-500 points): 10k volume = 100 points
    LEAST(500, top_missing_keyword_volume / 100)::integer +

    -- Completeness gap (0-300 points): lower score = higher priority
    (100 - COALESCE(completeness_score, 0)) * 3 +

    -- Missing keywords (0-200 points): each high-pri keyword = 40 points
    LEAST(200, high_priority_keywords_missing * 40)

    -- Stock penalty: if stock < 5, multiply by 0.5
  ) * CASE WHEN current_stock < 5 THEN 0.5 ELSE 1.0 END AS priority_score,

  -- Action reasons (for UI display)
  ARRAY_REMOVE(ARRAY[
    CASE WHEN completeness_score < 50 THEN 'Low completeness' END,
    CASE WHEN high_priority_keywords_missing > 0 THEN format('%s keywords missing', high_priority_keywords_missing) END,
    CASE WHEN top_missing_keyword_volume > 1000 THEN format('High-volume keyword (%s/mo)', top_missing_keyword_volume) END
  ], NULL) AS action_reasons

FROM product_metrics
WHERE current_stock >= 5  -- Don't prioritize out-of-stock products
ORDER BY priority_score DESC;

COMMENT ON VIEW bol_product_priority_queue IS
  'Autonomous agent work queue: products ranked by priority score combining business impact, content gaps, and keyword opportunities.';

-- ============================================================
-- Seed data: Default settings for existing customers
-- ============================================================
INSERT INTO bol_customer_settings (bol_customer_id, autonomy_level)
SELECT id, 'manual'
FROM bol_customers
WHERE NOT EXISTS (
  SELECT 1 FROM bol_customer_settings WHERE bol_customer_id = bol_customers.id
);
