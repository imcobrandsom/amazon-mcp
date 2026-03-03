-- Academy Articles Table
-- Stores knowledge base articles with admin edit/delete capabilities
-- Initial data is seeded from HubSpot export JSON

CREATE TABLE IF NOT EXISTS academy_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  subcategory TEXT,
  keywords TEXT,
  body TEXT NOT NULL,
  last_modified_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  is_published BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9\-/]+$')
);

-- Indexes
CREATE INDEX idx_academy_articles_category ON academy_articles(category);
CREATE INDEX idx_academy_articles_subcategory ON academy_articles(subcategory);
CREATE INDEX idx_academy_articles_slug ON academy_articles(slug);
CREATE INDEX idx_academy_articles_published ON academy_articles(is_published);
CREATE INDEX idx_academy_articles_search ON academy_articles USING gin(
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(keywords, ''))
);

-- RLS Policies
ALTER TABLE academy_articles ENABLE ROW LEVEL SECURITY;

-- Everyone can read published articles
CREATE POLICY "Anyone can read published articles"
  ON academy_articles
  FOR SELECT
  USING (is_published = true);

-- Admins can do everything (uses get_my_role() helper from migration 012)
CREATE POLICY "Admins can insert articles"
  ON academy_articles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "Admins can update articles"
  ON academy_articles
  FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "Admins can delete articles"
  ON academy_articles
  FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'admin');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_academy_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER academy_articles_updated_at
  BEFORE UPDATE ON academy_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_academy_articles_updated_at();

-- Function to seed from JSON (for initial migration)
-- This will be called manually after migration
COMMENT ON TABLE academy_articles IS 'Knowledge base articles with admin edit/delete. Initial seed from public/academy-articles.json';
