import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

// Test Supabase connection
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = createAdminClient();
    
    // Try simple query on existing table
    const { data, error } = await supabase
      .from('bol_customers')
      .select('id')
      .limit(1);

    return res.status(200).json({
      test: 'supabase-connection',
      success: !error,
      error: error?.message,
      hasData: !!data,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      test: 'supabase-connection',
      success: false,
      error: err.message ?? String(err),
      stack: err.stack,
    });
  }
}
