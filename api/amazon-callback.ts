import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

/**
 * GET /api/amazon-callback
 * Receives the authorization code from Amazon, exchanges it for tokens,
 * and stores the refresh token in Supabase.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const appUrl = process.env.APP_URL!;
  const { code, error } = req.query;

  if (error) {
    return res.redirect(302, `${appUrl}/settings?amazon_error=access_denied`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(302, `${appUrl}/settings?amazon_error=no_code`);
  }

  const clientId = process.env.AMAZON_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET!;
  const redirectUri = `${appUrl}/api/amazon-callback`;

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[amazon-callback] Token exchange failed:', text);
      return res.redirect(
        302,
        `${appUrl}/settings?amazon_error=token_exchange_failed`
      );
    }

    const data = await response.json();
    const { access_token, refresh_token, expires_in } = data;

    const supabase = createAdminClient();
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    const { error: dbError } = await supabase
      .from('amazon_credentials')
      .upsert(
        {
          id: 1,
          refresh_token,
          access_token,
          access_token_expires_at: expiresAt,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (dbError) {
      console.error('[amazon-callback] DB error:', dbError);
      return res.redirect(
        302,
        `${appUrl}/settings?amazon_error=db_error`
      );
    }

    return res.redirect(302, `${appUrl}/settings?amazon_connected=true`);
  } catch (err) {
    console.error('[amazon-callback] Unexpected error:', err);
    return res.redirect(302, `${appUrl}/settings?amazon_error=unknown`);
  }
}
