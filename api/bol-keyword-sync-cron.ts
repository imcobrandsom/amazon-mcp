/**
 * GET /api/bol-keyword-sync-cron
 * Daily cron job to sync keyword data for all active Bol customers
 * Vercel Cron: runs at 03:00 UTC daily
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret (Vercel cron jobs should set this header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'dev-cron-secret';

  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized - invalid cron secret' });
  }

  const supabase = createAdminClient();

  try {
    // Fetch all active bol customers
    const { data: customers, error: customersErr } = await supabase
      .from('bol_customers')
      .select('id, seller_name')
      .eq('active', true);

    if (customersErr) throw customersErr;
    if (!customers || customers.length === 0) {
      return res.status(200).json({
        message: 'No active customers to sync',
        synced: 0,
      });
    }

    const results: Array<{
      customer_id: string;
      seller_name: string;
      status: 'success' | 'error';
      keywords_updated?: number;
      error?: string;
    }> = [];

    // Sync keywords for each customer
    for (const customer of customers) {
      try {
        // Fetch all keywords for this customer
        const { data: keywords, error: kwErr } = await supabase
          .from('bol_product_keyword_targets')
          .select('id, ean, keyword')
          .eq('bol_customer_id', customer.id);

        if (kwErr) throw kwErr;
        if (!keywords || keywords.length === 0) {
          results.push({
            customer_id: customer.id,
            seller_name: customer.seller_name,
            status: 'success',
            keywords_updated: 0,
          });
          continue;
        }

        let updated = 0;

        // Update in_title and in_description flags for each keyword
        for (const kw of keywords) {
          // Fetch product data
          const { data: product } = await supabase
            .from('bol_raw_snapshots')
            .select('raw_data')
            .eq('bol_customer_id', customer.id)
            .eq('data_type', 'inventory')
            .order('fetched_at', { ascending: false })
            .limit(1)
            .single();

          if (!product) continue;

          const inventory = (product.raw_data as any)?.inventory || [];
          const prod = inventory.find((p: any) => p.ean === kw.ean);

          if (!prod) continue;

          const title = (prod.title || '').toLowerCase();
          const description = (prod.description || '').toLowerCase();
          const keywordLower = kw.keyword.toLowerCase();

          const inTitle = title.includes(keywordLower);
          const inDescription = description.includes(keywordLower);

          // Calculate keyword density (occurrences per 100 words)
          const words = (title + ' ' + description).split(/\s+/).length;
          const occurrences = (title + ' ' + description).toLowerCase().split(keywordLower).length - 1;
          const density = words > 0 ? Math.round((occurrences / words) * 100 * 100) / 100 : 0;

          // Update keyword record
          await supabase
            .from('bol_product_keyword_targets')
            .update({
              in_title: inTitle,
              in_description: inDescription,
              keyword_density_pct: density,
              updated_at: new Date().toISOString(),
            })
            .eq('id', kw.id);

          updated++;
        }

        results.push({
          customer_id: customer.id,
          seller_name: customer.seller_name,
          status: 'success',
          keywords_updated: updated,
        });
      } catch (err) {
        results.push({
          customer_id: customer.id,
          seller_name: customer.seller_name,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const totalKeywords = results.reduce((sum, r) => sum + (r.keywords_updated || 0), 0);

    return res.status(200).json({
      message: 'Keyword sync completed',
      customers_processed: customers.length,
      customers_success: successCount,
      total_keywords_updated: totalKeywords,
      results,
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: 'Keyword sync failed',
      details: (error as Error).message,
    });
  }
}
