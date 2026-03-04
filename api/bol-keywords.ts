/**
 * GET /api/bol-keywords?customerId=&[categorySlug=]&[keyword=]
 *
 * Zonder keyword: geeft per category_slug een overzicht van top keywords
 * (max 100 per categorie, gesorteerd op impressions DESC, niet-merk)
 *
 * Met keyword: geeft rank-history voor dat keyword (alle EANs, alle weken)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { customerId, categorySlug, keyword } = req.query as Record<string, string>;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();
  const eightWeeksAgo = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);

  if (keyword) {
    // Keyword detail: rank history per EAN over de laatste 8 weken
    const { data, error } = await supabase
      .from('bol_keyword_rankings')
      .select('ean, rank, impressions, week_of, category_slug')
      .eq('bol_customer_id', customerId)
      .eq('keyword', keyword.toLowerCase().trim())
      .gte('week_of', eightWeeksAgo)
      .order('week_of', { ascending: false })
      .limit(500);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ keyword, history: data ?? [] });
  }

  // Overview: voor elke categorie de top keywords op basis van meest recente week
  let query = supabase
    .from('bol_keyword_rankings')
    .select('keyword, category_slug, ean, rank, impressions, week_of')
    .eq('bol_customer_id', customerId)
    .eq('search_type', 'SEARCH')
    .gte('week_of', eightWeeksAgo)
    .order('week_of', { ascending: false })
    .order('impressions', { ascending: false })
    .limit(5000);

  if (categorySlug) query = query.eq('category_slug', categorySlug);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data ?? [];

  // Groepeer per categorie → per keyword (meest recente rank + impressions)
  const byCategory = new Map<string, Map<string, {
    keyword: string;
    category_slug: string;
    best_rank: number | null;
    best_ean: string | null;
    impressions: number;
    prev_impressions: number | null;
    week_of: string;
    ean_count: number;
  }>>();

  // Sorteer op week_of DESC (nieuwste eerst) zodat we de meest recente data pakken
  const sorted = [...rows].sort((a, b) =>
    new Date(b.week_of).getTime() - new Date(a.week_of).getTime()
  );

  // Track welke weeks we hebben per keyword (voor trend berekening)
  const weeksByKeyword = new Map<string, string[]>();

  for (const row of sorted) {
    const catSlug = row.category_slug ?? 'unknown';
    if (!byCategory.has(catSlug)) byCategory.set(catSlug, new Map());
    const catMap = byCategory.get(catSlug)!;

    const kw = (row.keyword as string)?.toLowerCase() ?? '';
    const weekKey = `${kw}|${catSlug}`;

    if (!weeksByKeyword.has(weekKey)) weeksByKeyword.set(weekKey, []);
    const weeks = weeksByKeyword.get(weekKey)!;

    if (!catMap.has(kw)) {
      catMap.set(kw, {
        keyword:          row.keyword as string,
        category_slug:    catSlug,
        best_rank:        row.rank as number | null,
        best_ean:         row.ean as string,
        impressions:      row.impressions as number ?? 0,
        prev_impressions: null,
        week_of:          row.week_of as string,
        ean_count:        1,
      });
      weeks.push(row.week_of as string);
    } else {
      const existing = catMap.get(kw)!;
      existing.ean_count++;
      // Bewaar de beste rank (laagste getal = beste positie)
      if (row.rank !== null && (existing.best_rank === null || (row.rank as number) < existing.best_rank)) {
        existing.best_rank = row.rank as number;
        existing.best_ean  = row.ean as string;
      }
      // Sla impressions op van de week ervoor (voor trend)
      if (weeks.length === 1 && row.week_of !== existing.week_of) {
        existing.prev_impressions = row.impressions as number ?? 0;
        weeks.push(row.week_of as string);
      }
    }
  }

  // Bouw response op
  const categories: Array<{
    category_slug: string;
    keywords: Array<{
      keyword: string;
      impressions: number;
      impressions_trend: 'up' | 'down' | 'stable' | 'new';
      best_rank: number | null;
      best_ean: string | null;
      week_of: string;
    }>;
  }> = [];

  for (const [catSlug, kwMap] of byCategory.entries()) {
    const keywords = Array.from(kwMap.values())
      .map(kw => ({
        keyword:           kw.keyword,
        impressions:       kw.impressions,
        impressions_trend: ((): 'up' | 'down' | 'stable' | 'new' => {
          if (kw.prev_impressions === null) return 'new';
          if (kw.impressions > kw.prev_impressions) return 'up';
          if (kw.impressions < kw.prev_impressions) return 'down';
          return 'stable';
        })(),
        best_rank:  kw.best_rank,
        best_ean:   kw.best_ean,
        week_of:    kw.week_of,
      }))
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
      .slice(0, 100); // top 100 per categorie

    categories.push({ category_slug: catSlug, keywords });
  }

  return res.status(200).json({ categories, total_rows: rows.length });
}
