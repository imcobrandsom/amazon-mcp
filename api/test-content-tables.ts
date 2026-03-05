import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Test environment variables first
    const envCheck = {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    };

    // Test Supabase client creation
    const supabase = createAdminClient();

    const results: Record<string, any> = {};

    // Test each table
    const tables = [
      'bol_client_brief',
      'bol_content_base',
      'bol_content_proposals',
      'bol_content_trends',
    ];

    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: false })
          .limit(1);

        results[table] = {
          exists: true,
          accessible: !error,
          error: error?.message,
          sampleCount: data?.length ?? 0,
          totalCount: count,
        };
      } catch (err: any) {
        results[table] = {
          exists: false,
          accessible: false,
          error: err.message ?? String(err),
        };
      }
    }

    return res.status(200).json({
      success: true,
      envCheck,
      tables: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message ?? String(error),
      stack: error.stack,
    });
  }
}
