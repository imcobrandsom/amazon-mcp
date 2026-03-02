/**
 * Diagnostic endpoint to check sync data state
 * GET /api/bol-sync-diagnostic?customerId=XXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const customerId = req.query.customerId as string;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }

    console.log('[bol-sync-diagnostic] Starting for customer:', customerId);

    const supabase = createAdminClient();
    console.log('[bol-sync-diagnostic] Supabase client created');

    // Check 1: Sync jobs status
    const { data: jobs, error: jobsErr } = await supabase
      .from('bol_sync_jobs')
      .select('id, data_type, status, attempts, started_at, completed_at, error')
      .eq('bol_customer_id', customerId)
      .order('started_at', { ascending: false })
      .limit(10);

    if (jobsErr) throw new Error(`Jobs query failed: ${jobsErr.message}`);

    // Check 2: Raw snapshots (do we have listings data?)
    const { data: snapshots, error: snapErr } = await supabase
      .from('bol_raw_snapshots')
      .select('id, data_type, record_count, created_at')
      .eq('bol_customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (snapErr) throw new Error(`Snapshots query failed: ${snapErr.message}`);

    // Check 3: Do we have listings snapshot with offers?
    const { data: listingsSnap, error: listingsErr } = await supabase
      .from('bol_raw_snapshots')
      .select('id, record_count, created_at, raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const hasOffersArray = listingsSnap?.raw_data
      ? Array.isArray((listingsSnap.raw_data as { offers?: unknown[] }).offers)
      : false;
    const offersCount = hasOffersArray
      ? (listingsSnap.raw_data as { offers: unknown[] }).offers.length
      : 0;

    // Check 4: Competitor snapshots count
    const { count: competitorCount, error: compErr } = await supabase
      .from('bol_competitor_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('bol_customer_id', customerId);

    if (compErr) throw new Error(`Competitor count failed: ${compErr.message}`);

    // Check 5: Product categories count
    const { count: categoriesCount, error: catErr } = await supabase
      .from('bol_product_categories')
      .select('id', { count: 'exact', head: true })
      .eq('bol_customer_id', customerId);

    if (catErr) throw new Error(`Categories count failed: ${catErr.message}`);

    return res.status(200).json({
      status: 'diagnostic_complete',
      customer_id: customerId,
      checks: {
        sync_jobs: {
          total: jobs?.length || 0,
          latest: jobs?.[0] || null,
          all: jobs || [],
        },
        raw_snapshots: {
          total: snapshots?.length || 0,
          by_type: snapshots?.reduce(
            (acc, s) => {
              acc[s.data_type] = (acc[s.data_type] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
          latest_listings: listingsSnap
            ? {
                id: listingsSnap.id,
                created_at: listingsSnap.created_at,
                record_count: listingsSnap.record_count,
                has_offers_array: hasOffersArray,
                offers_count: offersCount,
              }
            : null,
        },
        competitor_snapshots: {
          count: competitorCount || 0,
        },
        product_categories: {
          count: categoriesCount || 0,
        },
      },
      next_steps: !hasOffersArray
        ? '❌ No listings snapshot with offers array found. Trigger Main Sync (Step 1) + wait for completion (Step 2).'
        : competitorCount === 0
        ? '⚠️ Listings data exists but no competitor data. Trigger Extended Sync (Step 3).'
        : categoriesCount === 0
        ? '⚠️ Competitor data exists but no product categories. Trigger Competitor Analysis.'
        : '✅ All prerequisite data exists. Competitor research should work.',
    });
  } catch (err) {
    console.error('[bol-sync-diagnostic] Error:', err);
    return res.status(500).json({
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
