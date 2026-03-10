-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: Generic Content Examples for AI Training
-- Supports Bol.com now, Amazon/other marketplaces later
-- ══════════════════════════════════════════════════════════════════════════════

-- Generic content examples (reusable across marketplaces)
CREATE TABLE content_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Marketplace identification
  marketplace text NOT NULL CHECK (marketplace IN ('bol', 'amazon', 'generic')),
  category_slug text,  -- e.g., "sportlegging", "laptops", null for generic

  -- Example metadata
  example_type text NOT NULL CHECK (example_type IN (
    'good_title', 'bad_title',
    'good_description', 'bad_description'
  )),
  language text NOT NULL DEFAULT 'nl' CHECK (language IN ('nl', 'en', 'de', 'fr')),

  -- Content
  content text NOT NULL,
  reason text NOT NULL,  -- Why this is good/bad (injected in prompt)

  -- Quality tracking
  rating integer DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),  -- 5 = best example
  usage_count integer DEFAULT 0,  -- Track which examples improve proposals

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  created_by text,  -- user email or 'system'

  -- Prevent duplicates
  UNIQUE(marketplace, category_slug, example_type, content)
);

-- Fast lookups by marketplace + category + type, best examples first
CREATE INDEX idx_content_examples_lookup
  ON content_examples(marketplace, category_slug, example_type, rating DESC);

-- Row Level Security
ALTER TABLE content_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users" ON content_examples FOR ALL TO authenticated USING (true);

-- Documentation
COMMENT ON TABLE content_examples IS
  'Generic content examples for AI training across Bol, Amazon, and future marketplaces. Used for few-shot learning in content generation prompts.';

COMMENT ON COLUMN content_examples.marketplace IS
  'Marketplace identifier (bol, amazon, generic). Allows reusing table across platforms.';

COMMENT ON COLUMN content_examples.category_slug IS
  'Category slug (e.g., sportlegging, laptops). NULL = generic example applicable to all categories.';

COMMENT ON COLUMN content_examples.rating IS
  '1-5 quality score. 5 = best examples (used first), 1 = worst examples (what to avoid).';

COMMENT ON COLUMN content_examples.usage_count IS
  'Tracks how often this example is used in prompts. Helps identify most effective examples.';
