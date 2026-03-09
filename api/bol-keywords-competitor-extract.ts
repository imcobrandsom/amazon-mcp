/**
 * POST /api/bol-keywords-competitor-extract
 * Analyzes competitor content and extracts high-value keywords
 * Uses AI to identify keywords from competitor titles, descriptions, and search terms
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId, limit = 20 } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  try {
    // Step 1: Get products with competitor data but missing keywords
    const { data: products } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'inventory')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!products) {
      return res.status(404).json({ error: 'No product data found' });
    }

    const inventory = ((products.raw_data as any)?.items || []) as Array<{ ean?: string }>;

    // Get existing keyword coverage
    const { data: keywordCoverage } = await supabase
      .from('bol_product_keyword_targets')
      .select('ean, keyword')
      .eq('bol_customer_id', customerId);

    const eanToKeywords = new Map<string, Set<string>>();
    (keywordCoverage || []).forEach(kw => {
      if (!eanToKeywords.has(kw.ean)) {
        eanToKeywords.set(kw.ean, new Set());
      }
      eanToKeywords.get(kw.ean)!.add(kw.keyword.toLowerCase());
    });

    // Step 2: Get competitor snapshots for products with low keyword coverage
    const eansToAnalyze = inventory
      .filter(p => p.ean && (eanToKeywords.get(p.ean!)?.size || 0) < 5)
      .map(p => p.ean!)
      .slice(0, limit);

    if (eansToAnalyze.length === 0) {
      return res.status(200).json({
        message: 'All products have sufficient keyword coverage',
        analyzed: 0,
        keywords_added: 0,
      });
    }

    const { data: competitors } = await supabase
      .from('bol_competitor_snapshots')
      .select('ean, buy_box_winner, buy_box_price, competing_offers')
      .eq('bol_customer_id', customerId)
      .in('ean', eansToAnalyze)
      .order('fetched_at', { ascending: false });

    if (!competitors || competitors.length === 0) {
      return res.status(400).json({
        error: 'No competitor data available',
        hint: 'Run competitor sync first',
      });
    }

    let totalKeywordsAdded = 0;
    const results: Array<{ ean: string; keywords_added: number; keywords: string[] }> = [];

    // Step 3: Analyze each product's competitors using AI
    for (const comp of competitors) {
      const ean = comp.ean;
      const competingOffers = (comp.competing_offers || []) as Array<{
        sellerId?: string;
        price?: number;
        title?: string;
      }>;

      if (competingOffers.length === 0) continue;

      // Extract competitor titles
      const competitorTitles = competingOffers
        .map(o => o.title)
        .filter(Boolean)
        .slice(0, 10); // Analyze top 10 competitors

      if (competitorTitles.length === 0) continue;

      // Get current product title for context
      const { data: productSnap } = await supabase
        .from('bol_raw_snapshots')
        .select('catalog_attributes')
        .eq('bol_customer_id', customerId)
        .eq('data_type', 'catalog')
        .eq('raw_data->>ean', ean)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentTitle = (productSnap?.catalog_attributes as any)?.Title || '';
      const existingKeywords = Array.from(eanToKeywords.get(ean) || []);

      // Use Claude to extract high-value keywords
      const prompt = `Analyze these competitor product titles and extract high-value Dutch keywords for SEO optimization.

Current product title: ${currentTitle}

Competitor titles:
${competitorTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Already have these keywords: ${existingKeywords.join(', ')}

Extract 5-10 NEW high-value keywords that:
1. Appear frequently in competitor titles (high search intent)
2. Are NOT already in our keyword list
3. Are relevant for Dutch Bol.com search
4. Focus on product features, benefits, materials, or use cases
5. Prioritize specific terms over generic ones (e.g. "high waist" over "legging")

Return ONLY a JSON array of objects with this structure:
[
  {"keyword": "keyword phrase", "priority": 1-10, "reason": "why this keyword is valuable"}
]

Priority scale:
10 = Appears in 80%+ of competitor titles, high search intent
8-9 = Appears in 50-80% of titles, specific feature
6-7 = Appears in 30-50% of titles, relevant attribute
4-5 = Appears in <30% of titles, general term`;

      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: prompt,
          }],
        });

        const content = response.content[0];
        if (content.type !== 'text') continue;

        // Parse AI response
        const jsonMatch = content.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;

        const extractedKeywords = JSON.parse(jsonMatch[0]) as Array<{
          keyword: string;
          priority: number;
          reason: string;
        }>;

        // Insert new keywords
        const keywordsToInsert = extractedKeywords.map(kw => ({
          bol_customer_id: customerId,
          ean,
          keyword: kw.keyword.toLowerCase().trim(),
          priority: Math.min(10, Math.max(1, kw.priority)),
          source: 'competitor_analysis',
          // AI-generated reason stored as JSON in a future column
        }));

        if (keywordsToInsert.length > 0) {
          const { error: insertErr } = await supabase
            .from('bol_product_keyword_targets')
            .insert(keywordsToInsert)
            .select('id');

          if (!insertErr || insertErr.code === '23505') { // Allow duplicates to be skipped
            const addedCount = keywordsToInsert.length;
            totalKeywordsAdded += addedCount;
            results.push({
              ean,
              keywords_added: addedCount,
              keywords: keywordsToInsert.map(k => k.keyword),
            });
          }
        }

        // Rate limit: 1 request per second to avoid hitting Claude API limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (aiErr) {
        console.error(`AI extraction failed for EAN ${ean}:`, aiErr);
        // Continue with next product
      }
    }

    return res.status(200).json({
      message: 'Competitor keyword extraction completed',
      products_analyzed: results.length,
      keywords_added: totalKeywordsAdded,
      results,
    });

  } catch (err) {
    console.error('Competitor keyword extraction error:', err);
    return res.status(500).json({
      error: 'Failed to extract competitor keywords',
      details: (err as Error).message,
    });
  }
}
