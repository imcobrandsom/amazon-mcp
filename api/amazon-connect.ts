import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/amazon-connect
 * Redirects the user to the Amazon OAuth authorization page.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.AMAZON_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    return res.status(500).json({
      error: 'AMAZON_CLIENT_ID or APP_URL environment variable is missing',
    });
  }

  const redirectUri = `${appUrl}/api/amazon-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'advertising::campaign_management',
    response_type: 'code',
    redirect_uri: redirectUri,
  });

  return res.redirect(302, `https://www.amazon.com/ap/oa?${params.toString()}`);
}
