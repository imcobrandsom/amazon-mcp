-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: Category-Specific Content Guidelines
-- Extends bol_category_attribute_requirements with content generation guidance
-- ══════════════════════════════════════════════════════════════════════════════

-- Add content guidance columns to existing category requirements table
ALTER TABLE bol_category_attribute_requirements
  ADD COLUMN IF NOT EXISTS content_focus_areas text[] DEFAULT '{}',
  -- e.g., ['kleur', 'maat', 'pasvorm', 'materiaal'] for fashion
  -- e.g., ['processor', 'RAM', 'schermgrootte', 'garantie'] for electronics

  ADD COLUMN IF NOT EXISTS tone_guidelines text,
  -- e.g., "Benadruk comfort en prestaties" for sports
  -- e.g., "Technisch en informatief, geen marketing taal" for electronics

  ADD COLUMN IF NOT EXISTS priority_usps text[] DEFAULT '{}',
  -- e.g., ['ademend materiaal', 'perfecte pasvorm', 'duurzaam'] for sportlegging
  -- e.g., ['snelle opstart', 'lange accu', 'lichtgewicht'] for laptops

  ADD COLUMN IF NOT EXISTS attribute_templates jsonb DEFAULT '{}'::jsonb;
  -- Templates for how to phrase attributes in descriptions
  -- e.g., {"Colour": "Verkrijgbaar in {value}", "Size": "Maat {value} voor perfecte pasvorm"}

-- Documentation
COMMENT ON COLUMN bol_category_attribute_requirements.content_focus_areas IS
  'Category-specific focus areas for content generation (e.g., fashion=color/size/fit, electronics=specs/warranty)';

COMMENT ON COLUMN bol_category_attribute_requirements.tone_guidelines IS
  'Tone of voice guidelines for this category (e.g., "Benadruk comfort en prestaties" for sports)';

COMMENT ON COLUMN bol_category_attribute_requirements.priority_usps IS
  'Priority USPs that should be mentioned in content for this category';

COMMENT ON COLUMN bol_category_attribute_requirements.attribute_templates IS
  'JSONB templates for how to phrase specific attributes in descriptions';
