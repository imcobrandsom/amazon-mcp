import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Debug endpoint to check environment variables
 * DELETE THIS FILE AFTER DEBUGGING
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const hasSupabaseUrl = !!process.env.SUPABASE_URL;
  const hasSupabaseServiceKey = !!process.env.SUPABASE_SERVICE_KEY;

  return res.status(200).json({
    env: {
      SUPABASE_URL: hasSupabaseUrl ? 'SET' : 'MISSING',
      SUPABASE_SERVICE_KEY: hasSupabaseServiceKey ? 'SET' : 'MISSING',
      SUPABASE_URL_VALUE: hasSupabaseUrl ? process.env.SUPABASE_URL : null,
    }
  });
}
