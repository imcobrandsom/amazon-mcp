// JSON article (from static file)
export interface JsonAcademyArticle {
  title: string;
  subtitle: string;
  slug: string;
  category: string;
  subcategory: string;
  keywords: string;
  body: string;
  lastModified: string;
}

// Database article (from Supabase)
export interface AcademyArticle {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  category: string;
  subcategory: string | null;
  keywords: string | null;
  body: string;
  last_modified_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  is_published: boolean;
}

export interface AcademyCategoryGroup {
  category: string;
  subcategories: AcademySubcategoryGroup[];
  totalCount: number;
}

export interface AcademySubcategoryGroup {
  subcategory: string;
  articles: AcademyArticle[];
}
