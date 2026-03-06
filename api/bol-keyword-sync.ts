/**
 * POST /api/bol-keyword-sync
 * Syncs keyword data: search volumes, product ranks, and updates in_title/in_description flags
 * Triggered by cron or manual sync button
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getBolToken, getSearchTerms, getProductRanks } from './_lib/bol-api-client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  const supabase = createAdminClient();

  // Get customer credentials
  const { data: customer, error: custErr } = await supabase
    .from('bol_customers')
    .select('bol_client_id, bol_client_secret')
    .eq('id', customerId)
    .single();

  if (custErr || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Fetch all target keywords for this customer
  const { data: keywords, error: kwErr } = await supabase
    .from('bol_product_keyword_targets')
    .select('id, ean, keyword')
    .eq('bol_customer_id', customerId);

  if (kwErr || !keywords || keywords.length === 0) {
    return res.status(200).json({ message: 'No keywords to sync', updated: 0 });
  }

  let updated = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];

  // Batch process keywords (API limit: 100 per request for search terms)
  // Note: For MVP, we'll process sequentially. For production, consider parallel batching.
  for (const kw of keywords) {
    try {
      // Fetch search volume (handles single keyword)
      let volume = 0;
      try {
        const volumeData = await getSearchTerms(token, kw.keyword, 'MONTH', 1);
        volume = volumeData.searchTerm?.total ?? 0;
      } catch (volErr) {
        console.warn(`Search volume fetch failed for "${kw.keyword}":`, volErr);
        // Continue without volume data
      }

      // Fetch current rank for this keyword+EAN
      let rank: number | null = null;
      try {
        const rankData = await getProductRanks(token, kw.ean, today, 'SEARCH');
        rank = rankData.ranks.find(r => r.searchTerm?.toLowerCase() === kw.keyword.toLowerCase())?.rank ?? null;
      } catch (rankErr) {
        console.warn(`Rank fetch failed for EAN ${kw.ean}, keyword "${kw.keyword}":`, rankErr);
        // Continue without rank data
      }

      // Check if keyword appears in current title/description
      const { data: productData } = await supabase
        .from('bol_raw_snapshots')
        .select('catalog_attributes')
        .eq('bol_customer_id', customerId)
        .eq('data_type', 'catalog')
        .eq('raw_data->>ean', kw.ean)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single();

      const title = ((productData?.catalog_attributes as any)?.Title ?? '').toLowerCase();
      const desc = ((productData?.catalog_attributes as any)?.Description ?? '').toLowerCase();
      const kwLower = kw.keyword.toLowerCase();

      const inTitle = title.includes(kwLower);
      const inDesc = desc.includes(kwLower);

      // Calculate keyword density (rough: count occurrences / total words * 100)
      let density = 0;
      if (desc) {
        const kwCount = (desc.match(new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const totalWords = desc.split(/\s+/).length;
        density = totalWords > 0 ? (kwCount / totalWords * 100) : 0;
      }

      // Update keyword record
      await supabase
        .from('bol_product_keyword_targets')
        .update({
          search_volume: volume,
          current_organic_rank: rank,
          in_title: inTitle,
          in_description: inDesc,
          keyword_density_pct: Math.round(density * 100) / 100,  // 2 decimal places
          updated_at: new Date().toISOString(),
        })
        .eq('id', kw.id);

      updated++;

      // Rate limit spacing (250ms between keywords to avoid hitting Bol API limits)
      await new Promise(resolve => setTimeout(resolve, 250));

    } catch (err) {
      console.error(`Keyword sync error for "${kw.keyword}":`, err);
      errors++;
      // Continue with next keyword
    }
  }

  return res.status(200).json({
    message: 'Keyword sync completed',
    total: keywords.length,
    updated,
    errors,
  });
}
