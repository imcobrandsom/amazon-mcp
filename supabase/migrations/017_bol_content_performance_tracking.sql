-- ============================================================
-- Bol.com Content Performance Tracking — Phase 2
-- Tracks content update impact on rankings, traffic, and revenue
-- ============================================================

-- ============================================================
-- TABLE: bol_content_performance_snapshots
-- Before/after snapshots to measure content optimization impact
-- ============================================================
CREATE TABLE bol_content_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL REFERENCES bol_content_proposals(id) ON DELETE CASCADE,
  ean text NOT NULL,

  -- Snapshot timing
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('before', 'after_7d', 'after_14d', 'after_30d')),
  snapshot_date date NOT NULL,

  -- Organic performance metrics
  organic_rank_avg numeric,  -- Average rank across target keywords (lower = better)
  organic_rank_best integer, -- Best rank achieved
  organic_rank_worst integer, -- Worst rank
  keywords_tracked integer,  -- Number of keywords with rank data

  -- Traffic metrics (from offer insights if available)
  impressions integer,
  clicks integer,
  ctr_pct numeric(5,2),

  -- Conversion metrics
  conversions integer,
  cvr_pct numeric(5,2),
  revenue numeric(10,2),

  -- Advertising performance (if product is advertised)
  ad_impressions integer,
  ad_clicks integer,
  ad_spend numeric(10,2),
  ad_revenue numeric(10,2),
  ad_acos numeric(5,2),

  -- Quality metrics
  completeness_score integer,  -- From get_product_completeness()

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(proposal_id, snapshot_type)
);

CREATE INDEX idx_bol_content_perf_snapshots_proposal
  ON bol_content_performance_snapshots(proposal_id, snapshot_type);
CREATE INDEX idx_bol_content_perf_snapshots_date
  ON bol_content_performance_snapshots(snapshot_date DESC);

ALTER TABLE bol_content_performance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_content_performance_snapshots FOR ALL TO authenticated USING (true);

COMMENT ON TABLE bol_content_performance_snapshots IS
  'Performance snapshots before and after content updates. Used to measure ranking improvements, traffic increases, and revenue impact.';

-- ============================================================
-- VIEW: bol_content_performance_summary
-- Aggregates before/after metrics per proposal
-- ============================================================
CREATE OR REPLACE VIEW bol_content_performance_summary AS
SELECT
  p.id AS proposal_id,
  p.bol_customer_id,
  p.ean,
  p.status,
  p.pushed_at,

  -- Before metrics
  before.organic_rank_avg AS rank_before,
  before.impressions AS impressions_before,
  before.revenue AS revenue_before,
  before.completeness_score AS score_before,

  -- After 7d metrics
  after7.organic_rank_avg AS rank_after_7d,
  after7.impressions AS impressions_after_7d,
  after7.revenue AS revenue_after_7d,
  after7.completeness_score AS score_after_7d,

  -- After 30d metrics (final)
  after30.organic_rank_avg AS rank_after_30d,
  after30.impressions AS impressions_after_30d,
  after30.revenue AS revenue_after_30d,
  after30.completeness_score AS score_after_30d,

  -- Impact calculations (30d vs before)
  CASE
    WHEN before.organic_rank_avg IS NOT NULL AND after30.organic_rank_avg IS NOT NULL
    THEN ROUND(before.organic_rank_avg - after30.organic_rank_avg, 1)  -- Positive = improvement
    ELSE NULL
  END AS rank_improvement,

  CASE
    WHEN before.impressions IS NOT NULL AND after30.impressions IS NOT NULL
    THEN ROUND(100.0 * (after30.impressions - before.impressions) / NULLIF(before.impressions, 0), 1)
    ELSE NULL
  END AS impressions_change_pct,

  CASE
    WHEN before.revenue IS NOT NULL AND after30.revenue IS NOT NULL
    THEN ROUND(100.0 * (after30.revenue - before.revenue) / NULLIF(before.revenue, 0), 1)
    ELSE NULL
  END AS revenue_change_pct

FROM bol_content_proposals p
LEFT JOIN bol_content_performance_snapshots before
  ON before.proposal_id = p.id AND before.snapshot_type = 'before'
LEFT JOIN bol_content_performance_snapshots after7
  ON after7.proposal_id = p.id AND after7.snapshot_type = 'after_7d'
LEFT JOIN bol_content_performance_snapshots after30
  ON after30.proposal_id = p.id AND after30.snapshot_type = 'after_30d'
WHERE p.status = 'pushed'  -- Only show pushed proposals
ORDER BY p.pushed_at DESC;

COMMENT ON VIEW bol_content_performance_summary IS
  'Performance impact summary per content proposal. Shows before/after metrics and % change calculations.';

-- ============================================================
-- FUNCTION: Create 'before' snapshot when proposal is pushed
-- Called automatically by push endpoint
-- ============================================================
CREATE OR REPLACE FUNCTION create_before_snapshot(
  p_proposal_id uuid,
  p_customer_id uuid,
  p_ean text
)
RETURNS void AS $$
DECLARE
  completeness_rec record;
  keyword_ranks record;
BEGIN
  -- Get current completeness score
  SELECT overall_completeness_score INTO completeness_rec
  FROM get_product_completeness(p_customer_id, p_ean);

  -- Get current keyword ranking metrics
  SELECT
    AVG(current_organic_rank) AS avg_rank,
    MIN(current_organic_rank) AS best_rank,
    MAX(current_organic_rank) AS worst_rank,
    COUNT(*) FILTER (WHERE current_organic_rank IS NOT NULL) AS keywords_tracked
  INTO keyword_ranks
  FROM bol_product_keyword_targets
  WHERE bol_customer_id = p_customer_id
    AND ean = p_ean
    AND current_organic_rank IS NOT NULL;

  -- Insert 'before' snapshot
  INSERT INTO bol_content_performance_snapshots (
    bol_customer_id,
    proposal_id,
    ean,
    snapshot_type,
    snapshot_date,
    organic_rank_avg,
    organic_rank_best,
    organic_rank_worst,
    keywords_tracked,
    completeness_score
  ) VALUES (
    p_customer_id,
    p_proposal_id,
    p_ean,
    'before',
    CURRENT_DATE,
    keyword_ranks.avg_rank,
    keyword_ranks.best_rank,
    keyword_ranks.worst_rank,
    keyword_ranks.keywords_tracked,
    completeness_rec.overall_completeness_score
  )
  ON CONFLICT (proposal_id, snapshot_type) DO NOTHING;

  RAISE NOTICE 'Created before snapshot for proposal % (avg rank: %, score: %)',
    p_proposal_id,
    COALESCE(keyword_ranks.avg_rank, 0),
    COALESCE(completeness_rec.overall_completeness_score, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_before_snapshot IS
  'Creates a "before" snapshot when a proposal is pushed. Captures current rankings, completeness score, and traffic metrics.';

-- ============================================================
-- Helper function: Check which proposals need follow-up snapshots
-- Used by cron job to schedule after_7d, after_14d, after_30d snapshots
-- ============================================================
CREATE OR REPLACE FUNCTION get_proposals_needing_snapshots()
RETURNS TABLE (
  proposal_id uuid,
  bol_customer_id uuid,
  ean text,
  pushed_at timestamptz,
  days_since_push integer,
  missing_snapshot_type text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.bol_customer_id,
    p.ean,
    p.pushed_at,
    EXTRACT(DAY FROM NOW() - p.pushed_at)::integer AS days_since_push,
    CASE
      WHEN EXTRACT(DAY FROM NOW() - p.pushed_at) >= 30
           AND NOT EXISTS (SELECT 1 FROM bol_content_performance_snapshots WHERE proposal_id = p.id AND snapshot_type = 'after_30d')
      THEN 'after_30d'
      WHEN EXTRACT(DAY FROM NOW() - p.pushed_at) >= 14
           AND NOT EXISTS (SELECT 1 FROM bol_content_performance_snapshots WHERE proposal_id = p.id AND snapshot_type = 'after_14d')
      THEN 'after_14d'
      WHEN EXTRACT(DAY FROM NOW() - p.pushed_at) >= 7
           AND NOT EXISTS (SELECT 1 FROM bol_content_performance_snapshots WHERE proposal_id = p.id AND snapshot_type = 'after_7d')
      THEN 'after_7d'
      ELSE NULL
    END AS missing_snapshot_type
  FROM bol_content_proposals p
  WHERE p.status = 'pushed'
    AND p.pushed_at IS NOT NULL
    AND p.pushed_at > NOW() - INTERVAL '35 days'  -- Only track for 35 days max
  HAVING missing_snapshot_type IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_proposals_needing_snapshots IS
  'Returns proposals that need follow-up performance snapshots (7d, 14d, or 30d after push).';
