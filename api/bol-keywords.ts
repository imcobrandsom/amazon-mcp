/**
 * GET /api/bol-keywords?customerId=&[categorySlug=]&[keyword=]
 *
 * Zonder keyword: overzicht per category_slug, top keywords gesorteerd op zoekvolume
 * Met keyword: wekelijkse volume-history voor dat specifieke keyword
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { customerId, categorySlug, keyword } = req.query as Record<string, string>;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  if (keyword) {
    // Keyword detail: 26 weken volume history
    const { data, error } = await supabase
      .from('bol_keyword_search_volume')
      .select('keyword, category_slug, search_volume, week_of')
      .eq('bol_customer_id', customerId)
      .eq('keyword', keyword.toLowerCase().trim())
      .order('week_of', { ascending: true })
      .limit(52); // max 1 jaar

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ keyword, history: data ?? [] });
  }

  // Overview: alle keywords van afgelopen 8 weken per categorie
  const eightWeeksAgo = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);

  let query = supabase
    .from('bol_keyword_search_volume')
    .select('keyword, category_slug, search_volume, week_of')
    .eq('bol_customer_id', customerId)
    .gte('week_of', eightWeeksAgo)
    .order('week_of', { ascending: false })
    .limit(10000);

  if (categorySlug) query = query.eq('category_slug', categorySlug);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data ?? [];

  // Groepeer per categorie → per keyword
  // Neem de twee meest recente weken per keyword voor trend-berekening
  type KwEntry = {
    keyword: string;
    category_slug: string;
    current_volume: number;
    prev_volume: number | null;
    current_week: string;
  };

  const byCategory = new Map<string, Map<string, KwEntry>>();

  // Rows zijn al gesorteerd week_of DESC
  for (const row of rows) {
    const slug = (row.category_slug as string) ?? 'unknown';
    const kw   = ((row.keyword as string) ?? '').toLowerCase();
    if (!kw) continue;

    if (!byCategory.has(slug)) byCategory.set(slug, new Map());
    const catMap = byCategory.get(slug)!;

    if (!catMap.has(kw)) {
      catMap.set(kw, {
        keyword:        row.keyword as string,
        category_slug:  slug,
        current_volume: (row.search_volume as number) ?? 0,
        prev_volume:    null,
        current_week:   row.week_of as string,
      });
    } else {
      const existing = catMap.get(kw)!;
      // Tweede keer = vorige week (rows zijn DESC gesorteerd)
      if (existing.prev_volume === null && (row.week_of as string) !== existing.current_week) {
        existing.prev_volume = (row.search_volume as number) ?? 0;
      }
    }
  }

  const categories = Array.from(byCategory.entries()).map(([catSlug, kwMap]) => {
    const keywords = Array.from(kwMap.values())
      .map(kw => ({
        keyword:           kw.keyword,
        search_volume:     kw.current_volume,
        volume_trend: ((): 'up' | 'down' | 'stable' | 'new' => {
          if (kw.prev_volume === null) return 'new';
          if (kw.current_volume > kw.prev_volume)  return 'up';
          if (kw.current_volume < kw.prev_volume)  return 'down';
          return 'stable';
        })(),
        week_of: kw.current_week,
      }))
      .sort((a, b) => b.search_volume - a.search_volume)
      .slice(0, 200); // top 200 per categorie

    return { category_slug: catSlug, keywords };
  });

  return res.status(200).json({ categories, total_rows: rows.length });
}
