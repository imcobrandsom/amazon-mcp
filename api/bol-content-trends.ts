import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customerId } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId required' });
  }

  const supabase = createAdminClient();

  try {
    // Fetch existing active trends
    const { data: existingTrends, error } = await supabase
      .from('bol_content_trends')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('is_acted_upon', false)
      .order('detected_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Detect new trends: compare latest week vs previous week keyword volumes
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const { data: recentVolumes } = await supabase
      .from('bol_keyword_search_volume')
      .select('keyword, search_volume, week_of')
      .eq('bol_customer_id', customerId)
      .gte('week_of', twoWeeksAgo.toISOString())
      .order('week_of', { ascending: false });

    if (!recentVolumes || recentVolumes.length === 0) {
      return res.status(200).json({ trends: existingTrends ?? [] });
    }

    // Group by keyword
    const byKeyword = new Map<string, Array<{ search_volume: number; week_of: string }>>();
    for (const row of recentVolumes) {
      if (!byKeyword.has(row.keyword)) {
        byKeyword.set(row.keyword, []);
      }
      byKeyword.get(row.keyword)!.push({
        search_volume: row.search_volume,
        week_of: row.week_of,
      });
    }

    const newTrends: Array<{
      keyword: string;
      volume_change_pct: number;
      latest_volume: number;
    }> = [];

    for (const [keyword, weeks] of byKeyword.entries()) {
      if (weeks.length < 2) continue;

      // Sort by week_of desc
      weeks.sort((a, b) => new Date(b.week_of).getTime() - new Date(a.week_of).getTime());

      const latest = weeks[0];
      const previous = weeks[1];

      if (previous.search_volume === 0) continue;

      const changePercent = Math.round(
        ((latest.search_volume - previous.search_volume) / previous.search_volume) * 100
      );

      // Threshold: >25% increase AND volume >100
      if (changePercent > 25 && latest.search_volume > 100) {
        newTrends.push({
          keyword,
          volume_change_pct: changePercent,
          latest_volume: latest.search_volume,
        });
      }
    }

    // Find affected EANs for each new trend (from category insights)
    const { data: categoryInsights } = await supabase
      .from('bol_category_insights')
      .select('category_slug, trending_keywords')
      .eq('bol_customer_id', customerId);

    const categoryKeywords = new Map<string, string[]>();
    for (const insight of categoryInsights ?? []) {
      if (insight.trending_keywords) {
        const keywords = insight.trending_keywords.map((tk: any) => tk.keyword);
        categoryKeywords.set(insight.category_slug, keywords);
      }
    }

    // Get products per category
    const { data: productCategories } = await supabase
      .from('bol_product_category')
      .select('category_slug, ean')
      .eq('bol_customer_id', customerId);

    const eansByCategory = new Map<string, string[]>();
    for (const pc of productCategories ?? []) {
      if (!eansByCategory.has(pc.category_slug)) {
        eansByCategory.set(pc.category_slug, []);
      }
      eansByCategory.get(pc.category_slug)!.push(pc.ean);
    }

    // Insert new trends
    for (const trend of newTrends) {
      // Check if already exists
      const alreadyExists = (existingTrends ?? []).some(
        t => t.keyword === trend.keyword && t.trend_type === 'keyword_volume_spike'
      );
      if (alreadyExists) continue;

      // Find affected EANs
      let affectedEans: string[] = [];
      for (const [slug, keywords] of categoryKeywords.entries()) {
        if (keywords.includes(trend.keyword)) {
          const eans = eansByCategory.get(slug) ?? [];
          affectedEans = [...affectedEans, ...eans];
        }
      }

      if (affectedEans.length === 0) continue;

      await supabase.from('bol_content_trends').insert({
        bol_customer_id: customerId,
        trend_type: 'keyword_volume_spike',
        keyword: trend.keyword,
        volume_change_pct: trend.volume_change_pct,
        affected_eans: affectedEans,
      });
    }

    // Re-fetch all trends
    const { data: allTrends } = await supabase
      .from('bol_content_trends')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('is_acted_upon', false)
      .order('detected_at', { ascending: false });

    return res.status(200).json({ trends: allTrends ?? [] });
  } catch (error: any) {
    console.error('Trend detection error:', error);
    return res.status(500).json({ error: error.message ?? 'Trend detection failed' });
  }
}
