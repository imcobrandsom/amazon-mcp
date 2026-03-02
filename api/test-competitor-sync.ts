/**
 * Test endpoint to diagnose competitor sync issues
 * GET /api/test-competitor-sync
 */

import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: Request) {
  const supabase = createAdminClient();

  try {
    // Check 1: Do we have any active Bol customers?
    const { data: customers, error: custError } = await supabase
      .from('bol_customers')
      .select('id, name, is_active')
      .eq('is_active', true);

    if (custError) throw new Error(`Customer query failed: ${custError.message}`);

    // Check 2: Do we have catalog data?
    const { data: rawSnapshots, error: snapError } = await supabase
      .from('bol_raw_snapshots')
      .select('id, bol_customer_id, data_type, record_count, created_at')
      .eq('data_type', 'listings')
      .order('created_at', { ascending: false })
      .limit(5);

    if (snapError) throw new Error(`Snapshot query failed: ${snapError.message}`);

    // Check 3: Do new tables exist?
    const { data: categories, error: catError } = await supabase
      .from('bol_product_categories')
      .select('id')
      .limit(1);

    const { data: insights, error: insError } = await supabase
      .from('bol_category_insights')
      .select('id')
      .limit(1);

    return new Response(
      JSON.stringify({
        status: 'diagnostic_complete',
        checks: {
          active_customers: {
            count: customers?.length || 0,
            customers: customers?.map(c => ({ id: c.id, name: c.name })) || [],
          },
          catalog_data: {
            has_data: (rawSnapshots?.length || 0) > 0,
            latest_snapshots: rawSnapshots?.map(s => ({
              customer: s.bol_customer_id,
              records: s.record_count,
              created: s.created_at,
            })) || [],
          },
          new_tables: {
            bol_product_categories: catError ? `Error: ${catError.message}` : 'OK',
            bol_category_insights: insError ? `Error: ${insError.message}` : 'OK',
          },
        },
        next_steps: rawSnapshots && rawSnapshots.length > 0
          ? 'Catalog data exists! You can trigger competitor analysis.'
          : 'No catalog data yet. Run extended sync first from the dashboard.',
      }, null, 2),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: (err as Error).message,
        stack: (err as Error).stack,
      }, null, 2),
      { status: 500 }
    );
  }
}
