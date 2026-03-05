import type { VercelRequest, VercelResponse } from '@vercel/node';

// Test environment variables
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'MISSING',
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'MISSING',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  return res.status(200).json({
    test: 'env-check',
    env,
    timestamp: new Date().toISOString(),
  });
}
