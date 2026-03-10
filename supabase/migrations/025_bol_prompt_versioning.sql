-- Migration: Bol.com Content Prompt Versioning System
-- Enables database-driven prompt iteration and A/B testing

-- Prompt versions table
CREATE TABLE IF NOT EXISTS bol_content_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id uuid REFERENCES bol_customers(id) ON DELETE CASCADE,

  -- Version metadata
  version_number integer NOT NULL,
  version_name text, -- e.g., "v2-shorter-titles", "v3-more-keywords"
  is_active boolean DEFAULT false,
  is_ab_test boolean DEFAULT false, -- if true, randomly used 50% of time

  -- Prompt content
  system_instructions text NOT NULL,
  title_template text,
  description_template text,

  -- Constraints and rules (JSONB for flexibility)
  title_rules jsonb DEFAULT '{
    "min_length": 50,
    "max_length": 150,
    "required_elements": ["brand", "product_type"],
    "forbidden_words": ["SALE", "KORTING"],
    "keyword_count": {"min": 2, "max": 5}
  }'::jsonb,

  description_rules jsonb DEFAULT '{
    "min_length": 250,
    "max_length": 2000,
    "required_sections": ["intro", "usps", "details"],
    "usp_count": {"min": 3, "max": 5},
    "keyword_density": {"min": 0.02, "max": 0.05}
  }'::jsonb,

  -- Performance tracking
  performance_metrics jsonb DEFAULT '{
    "total_generations": 0,
    "avg_approval_rate": null,
    "avg_title_length": null,
    "avg_description_length": null,
    "avg_keywords_added": null
  }'::jsonb,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  created_by text, -- user email/id who created this version
  activated_at timestamptz,
  deactivated_at timestamptz
);

-- Indexes
CREATE INDEX idx_bol_prompt_versions_customer ON bol_content_prompt_versions(bol_customer_id);
CREATE INDEX idx_bol_prompt_versions_active ON bol_content_prompt_versions(bol_customer_id, is_active) WHERE is_active = true;
CREATE INDEX idx_bol_prompt_versions_version_num ON bol_content_prompt_versions(bol_customer_id, version_number DESC);

-- Unique constraint: version number per customer
CREATE UNIQUE INDEX idx_bol_prompt_versions_unique
  ON bol_content_prompt_versions(bol_customer_id, version_number);

-- Track which version was used for each proposal
ALTER TABLE bol_content_proposals
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES bol_content_prompt_versions(id);

-- Add index for performance queries
CREATE INDEX IF NOT EXISTS idx_bol_proposals_prompt_version
  ON bol_content_proposals(prompt_version_id);

-- Function to get active prompt version
CREATE OR REPLACE FUNCTION get_active_prompt_version(p_customer_id uuid)
RETURNS TABLE (
  id uuid,
  version_number integer,
  system_instructions text,
  title_template text,
  description_template text,
  title_rules jsonb,
  description_rules jsonb
) AS $$
BEGIN
  -- Check if A/B testing is enabled
  IF EXISTS (
    SELECT 1 FROM bol_content_prompt_versions
    WHERE bol_customer_id = p_customer_id AND is_ab_test = true
  ) THEN
    -- Return random version from A/B test pool
    RETURN QUERY
    SELECT
      v.id, v.version_number, v.system_instructions,
      v.title_template, v.description_template,
      v.title_rules, v.description_rules
    FROM bol_content_prompt_versions v
    WHERE v.bol_customer_id = p_customer_id
      AND v.is_ab_test = true
    ORDER BY random()
    LIMIT 1;
  ELSE
    -- Return single active version
    RETURN QUERY
    SELECT
      v.id, v.version_number, v.system_instructions,
      v.title_template, v.description_template,
      v.title_rules, v.description_rules
    FROM bol_content_prompt_versions v
    WHERE v.bol_customer_id = p_customer_id
      AND v.is_active = true
    ORDER BY v.version_number DESC
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to activate a version (deactivates others)
CREATE OR REPLACE FUNCTION activate_prompt_version(p_version_id uuid)
RETURNS void AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  -- Get customer_id from version
  SELECT bol_customer_id INTO v_customer_id
  FROM bol_content_prompt_versions
  WHERE id = p_version_id;

  -- Deactivate all versions for this customer
  UPDATE bol_content_prompt_versions
  SET is_active = false,
      is_ab_test = false,
      deactivated_at = now()
  WHERE bol_customer_id = v_customer_id;

  -- Activate the selected version
  UPDATE bol_content_prompt_versions
  SET is_active = true,
      activated_at = now()
  WHERE id = p_version_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update performance metrics after generation
CREATE OR REPLACE FUNCTION update_prompt_performance(
  p_version_id uuid,
  p_title_length integer,
  p_description_length integer,
  p_keywords_added integer
)
RETURNS void AS $$
BEGIN
  UPDATE bol_content_prompt_versions
  SET performance_metrics = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          performance_metrics,
          '{total_generations}',
          to_jsonb((performance_metrics->>'total_generations')::int + 1)
        ),
        '{avg_title_length}',
        to_jsonb(
          (COALESCE((performance_metrics->>'avg_title_length')::numeric, 0) *
           (performance_metrics->>'total_generations')::int + p_title_length) /
          ((performance_metrics->>'total_generations')::int + 1)
        )
      ),
      '{avg_description_length}',
      to_jsonb(
        (COALESCE((performance_metrics->>'avg_description_length')::numeric, 0) *
         (performance_metrics->>'total_generations')::int + p_description_length) /
        ((performance_metrics->>'total_generations')::int + 1)
      )
    ),
    '{avg_keywords_added}',
    to_jsonb(
      (COALESCE((performance_metrics->>'avg_keywords_added')::numeric, 0) *
       (performance_metrics->>'total_generations')::int + p_keywords_added) /
      ((performance_metrics->>'total_generations')::int + 1)
    )
  )
  WHERE id = p_version_id;
END;
$$ LANGUAGE plpgsql;

-- Seed default version for existing customers
INSERT INTO bol_content_prompt_versions (
  bol_customer_id,
  version_number,
  version_name,
  is_active,
  system_instructions,
  created_by
)
SELECT
  id as bol_customer_id,
  1 as version_number,
  'Default (from code)' as version_name,
  true as is_active,
  'Je bent een SEO expert gespecialiseerd in Bol.com productcontent. Genereer Nederlandse content die converteert en goed rankt.' as system_instructions,
  'system' as created_by
FROM bol_customers
WHERE NOT EXISTS (
  SELECT 1 FROM bol_content_prompt_versions
  WHERE bol_content_prompt_versions.bol_customer_id = bol_customers.id
);

COMMENT ON TABLE bol_content_prompt_versions IS 'Stores versioned prompts for content generation skill with A/B testing support';
COMMENT ON FUNCTION get_active_prompt_version IS 'Returns active prompt version, or random A/B test version if testing is enabled';
COMMENT ON FUNCTION activate_prompt_version IS 'Activates a prompt version and deactivates all others for the customer';
COMMENT ON FUNCTION update_prompt_performance IS 'Updates performance metrics after each content generation';
