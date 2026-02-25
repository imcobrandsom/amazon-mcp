import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAmazonAccessToken } from './_lib/amazon-token';

/**
 * GET /api/token-refresh
 * Returns a valid Amazon Ads access token (refreshes if expired).
 * Called server-side only — never expose to client directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = await getAmazonAccessToken();
    return res.status(200).json({ access_token: token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[token-refresh]', message);
    return res.status(500).json({ error: message });
  }
}
