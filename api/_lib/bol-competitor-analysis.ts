/**
 * AI-powered competitor content analysis using Claude Sonnet 4.5
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface CompetitorProduct {
  competitor_ean: string;
  title: string | null;
  description: string | null;
  brand: string | null;
  list_price: number | null;
}

interface CompetitorAnalysisResult {
  ean: string;
  title_score: number;
  title_length: number;
  description_score: number;
  description_length: number;
  keywords: string[];
  usps: string[];
  quality_notes: string;
}

/**
 * Batch analyze competitor products for content quality and extract insights
 */
export async function analyzeCompetitorContent(
  categorySlug: string,
  products: CompetitorProduct[]
): Promise<CompetitorAnalysisResult[]> {
  if (products.length === 0) return [];

  // Batch products in groups of 50 to avoid token limits
  const batchSize = 50;
  const allResults: CompetitorAnalysisResult[] = [];

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const results = await analyzeBatch(categorySlug, batch);
    allResults.push(...results);

    // Rate limit: 150ms between batches
    if (i + batchSize < products.length) {
      await sleep(150);
    }
  }

  return allResults;
}

async function analyzeBatch(
  categorySlug: string,
  products: CompetitorProduct[]
): Promise<CompetitorAnalysisResult[]> {
  const prompt = `You are analyzing competitor product listings for the category "${categorySlug}" on Bol.com (Netherlands marketplace).

For each product below, score the content quality and extract insights:

${products.map((p, i) => `
## Product ${i + 1} (EAN: ${p.competitor_ean})
**Title:** ${p.title || '(missing)'}
**Description:** ${p.description || '(missing)'}
**Brand:** ${p.brand || '(missing)'}
**Price:** €${p.list_price?.toFixed(2) || 'N/A'}
`).join('\n')}

For each product, provide:

1. **Title Score (0-100)**: Based on:
   - Length (150-175 characters is optimal for Bol.com)
   - Keyword usage and relevance
   - Clarity and completeness
   - Missing title = 0

2. **Description Score (0-100)**: Based on:
   - Completeness (aim for 300-500 chars minimum)
   - Keyword density
   - Persuasiveness and detail
   - Missing description = 0

3. **Extracted Keywords**: Array of 5-10 most relevant product-specific keywords/phrases
   Example for sportswear: ["anti-slip", "moisture-wicking", "yoga", "high-waist"]

4. **Extracted USPs**: Array of unique selling propositions mentioned
   Example: ["breathable fabric", "4-way stretch", "eco-friendly material"]

Return **ONLY** a JSON array (no markdown, no explanation):

[
  {
    "ean": "1234567890123",
    "title_score": 85,
    "title_length": 165,
    "description_score": 70,
    "description_length": 450,
    "keywords": ["anti-slip", "moisture-wicking"],
    "usps": ["breathable fabric", "high waist"],
    "quality_notes": "Strong title. Description could be more detailed."
  }
]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8192,
      temperature: 0.3, // Lower temperature for more consistent JSON
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      console.error('Unexpected response type from Claude');
      return fallbackAnalysis(products);
    }

    // Extract JSON from response (handle cases where Claude wraps it in markdown)
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/, '').trim();
    }

    const results = JSON.parse(jsonText) as CompetitorAnalysisResult[];
    return results;
  } catch (err) {
    console.error('AI analysis failed:', err);
    return fallbackAnalysis(products);
  }
}

/**
 * Fallback analysis if AI call fails - basic heuristics
 */
function fallbackAnalysis(products: CompetitorProduct[]): CompetitorAnalysisResult[] {
  return products.map(p => {
    const titleLen = p.title?.length || 0;
    const descLen = p.description?.length || 0;

    // Simple scoring based on length
    const titleScore = p.title
      ? Math.min(100, Math.max(0, 100 - Math.abs(titleLen - 160) * 0.5))
      : 0;
    const descScore = p.description
      ? Math.min(100, Math.max(0, (descLen / 500) * 100))
      : 0;

    return {
      ean: p.competitor_ean,
      title_score: Math.round(titleScore),
      title_length: titleLen,
      description_score: Math.round(descScore),
      description_length: descLen,
      keywords: [],
      usps: [],
      quality_notes: 'Fallback analysis (AI unavailable)',
    };
  });
}

/**
 * Generate category-level insights from competitor data
 */
export async function generateCategoryInsights(
  customerId: string,
  categorySlug: string,
  categoryId: string | null,
  categoryPath: string,
  yourProducts: Array<{ ean: string; our_price: number | null }>,
  allProducts: Array<{
    competitor_ean: string;
    title: string | null;
    list_price: number | null;
    is_customer_product: boolean;
  }>,
  analyses: Array<{
    competitor_ean: string;
    title_score: number | null;
    description_score: number | null;
    extracted_keywords: string[] | null;
    extracted_usps: string[] | null;
  }>,
  supabase: any
): Promise<void> {
  // Filter competitors (exclude your products)
  const competitors = allProducts.filter(p => !p.is_customer_product);

  // Calculate price metrics
  const competitorPrices = competitors
    .map(c => c.list_price)
    .filter((p): p is number => p !== null && p > 0);
  const avgCompetitorPrice =
    competitorPrices.length > 0
      ? competitorPrices.reduce((sum, p) => sum + p, 0) / competitorPrices.length
      : null;

  const yourPrices = yourProducts
    .map(p => p.our_price)
    .filter((p): p is number => p !== null && p > 0);
  const avgYourPrice =
    yourPrices.length > 0
      ? yourPrices.reduce((sum, p) => sum + p, 0) / yourPrices.length
      : null;

  const priceGapPercent =
    avgCompetitorPrice && avgYourPrice
      ? ((avgYourPrice - avgCompetitorPrice) / avgCompetitorPrice) * 100
      : null;

  // Top competitors by relevance/price
  const topCompetitors = competitors
    .sort((a, b) => (a.list_price || 999999) - (b.list_price || 999999))
    .slice(0, 20)
    .map(c => ({
      ean: c.competitor_ean,
      title: c.title,
      price: c.list_price,
    }));

  // Trending keywords (frequency count)
  const keywordFreq = new Map<string, number>();
  analyses.forEach(a => {
    a.extracted_keywords?.forEach(kw => {
      keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1);
    });
  });

  const trendingKeywords = Array.from(keywordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([keyword, frequency]) => ({ keyword, frequency, trend: 'stable' }));

  // Trending USPs
  const uspFreq = new Map<string, number>();
  analyses.forEach(a => {
    a.extracted_usps?.forEach(usp => {
      uspFreq.set(usp, (uspFreq.get(usp) || 0) + 1);
    });
  });

  const trendingUsps = Array.from(uspFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([usp, frequency]) => ({ usp, frequency, trend: 'stable' }));

  // Average content quality
  const contentScores = analyses
    .map(a => {
      const titleScore = a.title_score || 0;
      const descScore = a.description_score || 0;
      return (titleScore + descScore) / 2;
    })
    .filter(score => score > 0);

  const avgContentQuality =
    contentScores.length > 0
      ? contentScores.reduce((sum, s) => sum + s, 0) / contentScores.length
      : null;

  // Insert category insights
  await supabase.from('bol_category_insights').insert({
    bol_customer_id: customerId,
    category_slug: categorySlug,
    category_id: categoryId,
    category_path: categoryPath,
    your_product_count: yourProducts.length,
    competitor_count: competitors.length,
    total_products: allProducts.length,
    avg_competitor_price: avgCompetitorPrice,
    avg_your_price: avgYourPrice,
    price_gap_percent: priceGapPercent,
    top_competitors: topCompetitors,
    trending_keywords: trendingKeywords,
    trending_usps: trendingUsps,
    content_quality_avg: avgContentQuality,
    generated_at: new Date().toISOString(),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
