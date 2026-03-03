export interface AcademyArticle {
  title: string;
  subtitle: string;
  slug: string;        // e.g. "strategy/marketing-plan/31-touch-tell-sell-care"
  category: string;
  subcategory: string;
  keywords: string;
  body: string;        // raw HTML from HubSpot
  lastModified: string;
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
