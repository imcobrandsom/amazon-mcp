/**
 * Simple test endpoint to verify deployment
 */

import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: Request) {
  try {
    const supabase = createAdminClient();

    const { data: customers } = await supabase
      .from('bol_customers')
      .select('id, name')
      .eq('is_active', true);

    return new Response(JSON.stringify({
      status: 'ok',
      customers: customers?.map(c => ({ id: c.id, name: c.name })) || []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: (err as Error).message,
      stack: (err as Error).stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
