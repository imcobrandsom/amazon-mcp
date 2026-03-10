/**
 * Admin types for content training management
 */

export interface ContentExample {
  id: string;
  marketplace: 'bol' | 'amazon' | 'generic';
  category_slug: string | null;
  example_type: 'good_title' | 'bad_title' | 'good_description' | 'bad_description';
  language: 'nl' | 'en' | 'de' | 'fr';
  content: string;
  reason: string;
  rating: number; // 1-5
  usage_count: number;
  created_at: string;
  created_by: string | null;
}

export interface CategoryGuidelines {
  id: string;
  bol_customer_id: string;
  category_slug: string;
  category_name: string | null;
  content_focus_areas: string[];
  tone_guidelines: string | null;
  priority_usps: string[];
  attribute_templates: Record<string, string>;
  required_attributes: string[];
  recommended_attributes: string[];
  title_min_length: number;
  title_max_length: number;
  description_min_length: number;
}
