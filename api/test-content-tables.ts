import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  try {
    const results: Record<string, any> = {};

    // Test each table
    const tables = [
      'bol_client_brief',
      'bol_content_base',
      'bol_content_proposals',
      'bol_content_trends',
    ];

    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);

      results[table] = {
        exists: !error,
        error: error?.message,
        row_count: data?.length ?? 0,
      };
    }

    return res.status(200).json(results);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
