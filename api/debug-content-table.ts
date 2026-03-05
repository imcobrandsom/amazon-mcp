import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

// Test specific content table access
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = createAdminClient();
    
    // Test bol_client_brief table specifically
    const { data, error, count } = await supabase
      .from('bol_client_brief')
      .select('*', { count: 'exact' })
      .limit(1);

    return res.status(200).json({
      test: 'bol_client_brief-access',
      success: !error,
      error: error?.message,
      errorCode: error?.code,
      errorDetails: error?.details,
      errorHint: error?.hint,
      hasData: !!data,
      rowCount: data?.length ?? 0,
      totalCount: count,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      test: 'bol_client_brief-access',
      success: false,
      error: err.message ?? String(err),
      stack: err.stack,
    });
  }
}
