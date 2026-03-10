-- ══════════════════════════════════════════════════════════════════════════════
-- Seed: Category Content Guidelines
-- Fashion vs. Electronics examples showing different content focus
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- FASHION CATEGORY: Sportlegging
-- Focus: kleur, maat, pasvorm, materiaal, comfort
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE bol_category_attribute_requirements
SET
  content_focus_areas = ARRAY['kleur', 'maat', 'pasvorm', 'materiaal', 'gebruik'],
  tone_guidelines = 'Benadruk comfort, prestaties en duurzaamheid. Gebruik actieve taal (hardlopen, yoga, fitness). Focus op hoe het product voelt en presteert tijdens sport.',
  priority_usps = ARRAY['ademend materiaal', 'perfecte pasvorm', 'vocht-afvoerend', 'high waist ondersteuning', 'duurzaam'],
  attribute_templates = '{
    "Colour": "Verkrijgbaar in {value}",
    "Size Clothing": "Maat {value} - raadpleeg maattabel voor perfecte pasvorm",
    "Material": "Gemaakt van {value} voor optimaal comfort tijdens intensieve workouts",
    "Pattern": "Design: {value}",
    "Fit Form": "{value} pasvorm voor maximale bewegingsvrijheid"
  }'::jsonb
WHERE category_slug = 'sportlegging';

-- ══════════════════════════════════════════════════════════════════════════════
-- FASHION CATEGORY: Sport-BHS
-- Focus: support level, pasvorm, comfort, maat
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE bol_category_attribute_requirements
SET
  content_focus_areas = ARRAY['support level', 'maat', 'pasvorm', 'materiaal', 'comfort'],
  tone_guidelines = 'Benadruk support, comfort en functionele features. Leg impact levels uit (low/mid/high). Focus op waarvoor de BH geschikt is.',
  priority_usps = ARRAY['optimale ondersteuning', 'ademend materiaal', 'verstelbare bandjes', 'anti-slip band', 'geen beugel'],
  attribute_templates = '{
    "Support Level": "{value} support - geschikt voor {context}",
    "Colour": "Verkrijgbaar in {value}",
    "Size Clothing": "Maat {value} - meet je borstomvang voor de juiste pasvorm",
    "Material": "Gemaakt van {value} voor maximaal comfort"
  }'::jsonb
WHERE category_slug = 'sport-bhs';

-- ══════════════════════════════════════════════════════════════════════════════
-- ELECTRONICS CATEGORY: Laptops
-- Focus: specs (processor, RAM, opslag), praktisch gebruik, garantie
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE bol_category_attribute_requirements
SET
  content_focus_areas = ARRAY['processor', 'RAM', 'opslag', 'schermgrootte', 'garantie', 'accu', 'connectiviteit'],
  tone_guidelines = 'Technisch en informatief, maar toegankelijk. Leg specs uit in begrijpelijke termen (bijv. "8GB RAM = soepel multitasken met Chrome, Office en videobellen"). Vermeld praktisch gebruik en garantie.',
  priority_usps = ARRAY['snelle opstart (SSD)', 'lange accuduur', 'Full HD scherm', 'lichtgewicht', 'stil werkend', 'multitask prestaties'],
  attribute_templates = '{
    "Processor": "{value} - {context over prestaties zoals multitasking, video editing, gaming}",
    "RAM": "{value} - voldoende voor {praktische voorbeelden zoals browsen, Office, videobellen}",
    "Storage": "{value} SSD voor snelle opstart (< 10 seconden) en ruim voor bestanden/foto''s",
    "Screen Size": "{value} scherm - {context zoals compact voor onderweg of groot voor thuiswerk}",
    "Operating System": "{value} - nieuwste versie met {garantie periode} garantie"
  }'::jsonb
WHERE category_slug = 'laptops';

-- ══════════════════════════════════════════════════════════════════════════════
-- GENERIC FALLBACK: No category-specific guidelines
-- Products without specific guidelines will use only examples
-- ══════════════════════════════════════════════════════════════════════════════

-- Note: No UPDATE needed for other categories. They will gracefully fallback to:
-- 1. Generic examples (category_slug IS NULL in content_examples)
-- 2. Base length constraints from required_attributes/recommended_attributes
-- 3. No category-specific section in prompt (code checks for non-empty arrays)
