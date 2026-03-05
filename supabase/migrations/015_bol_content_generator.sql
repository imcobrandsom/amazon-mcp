-- ── Client brief ─────────────────────────────────────────────────────────────
-- One row per bol_customer, stores tone of voice and brand rules for AI
CREATE TABLE bol_client_brief (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id  uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  brief_text       text NOT NULL DEFAULT '',   -- full freeform brief (tone, exceptions, do/don'ts)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bol_customer_id)
);
ALTER TABLE bol_client_brief ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_client_brief FOR ALL TO authenticated USING (true);

-- ── Basis content (uploaded by client, per EAN) ───────────────────────────────
CREATE TABLE bol_content_base (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id  uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  ean              text NOT NULL,
  sku              text,
  title            text,                       -- raw client title
  description      text,                       -- full description as-is from client
  source_filename  text,                       -- original Excel filename for audit
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bol_customer_id, ean)
);
ALTER TABLE bol_content_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_content_base FOR ALL TO authenticated USING (true);

-- ── Content proposals ─────────────────────────────────────────────────────────
-- One row per EAN per generation run (new row = new version, full history kept)
CREATE TABLE bol_content_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id      uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  ean                  text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','pushed','rejected')),
  trigger_reason       text NOT NULL DEFAULT 'quality_score'
                         CHECK (trigger_reason IN ('quality_score','keyword_trend','manual')),
  -- Current content (snapshot at time of generation)
  current_title        text,
  current_description  text,
  -- AI-proposed content
  proposed_title       text NOT NULL,
  proposed_description text NOT NULL,         -- full description (intro + bullets + long)
  proposed_description_parts jsonb,           -- {intro, usps: string[], long} parsed parts
  -- Quality scores
  score_before         integer,
  score_after_estimate integer,
  -- Change tracking
  changes_summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {
  --   "title_changed": bool,
  --   "keywords_added": string[],
  --   "keywords_removed": string[],
  --   "keywords_promoted_to_title": string[],
  --   "description_parts_changed": string[],
  --   "title_chars_before": number,
  --   "title_chars_after": number,
  --   "desc_chars_before": number,
  --   "desc_chars_after": number
  -- }
  -- Timestamps
  generated_at         timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  pushed_at            timestamptz,
  rejected_at          timestamptz
);
CREATE INDEX ON bol_content_proposals (bol_customer_id, ean, generated_at DESC);
ALTER TABLE bol_content_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_content_proposals FOR ALL TO authenticated USING (true);

-- ── Trend notifications ───────────────────────────────────────────────────────
CREATE TABLE bol_content_trends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bol_customer_id  uuid NOT NULL REFERENCES bol_customers(id) ON DELETE CASCADE,
  trend_type       text NOT NULL CHECK (trend_type IN ('keyword_volume_spike','new_top_keyword','competitor_content_change')),
  keyword          text,                       -- the keyword that triggered this
  volume_change_pct integer,                  -- % change vs previous week
  affected_eans    text[] NOT NULL DEFAULT '{}',
  is_acted_upon    boolean NOT NULL DEFAULT false,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  acted_upon_at    timestamptz
);
CREATE INDEX ON bol_content_trends (bol_customer_id, is_acted_upon, detected_at DESC);
ALTER TABLE bol_content_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON bol_content_trends FOR ALL TO authenticated USING (true);
