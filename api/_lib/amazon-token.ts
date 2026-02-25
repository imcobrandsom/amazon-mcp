import { createAdminClient } from './supabase-admin.js';

// In-memory cache per function instance (~15min warm)
let memCache: { accessToken: string; expiresAt: number } | null = null;

export async function getAmazonAccessToken(): Promise<string> {
  const now = Date.now();

  // Return in-memory cached token if still valid (60s buffer)
  if (memCache && memCache.expiresAt - now > 60_000) {
    return memCache.accessToken;
  }

  const supabase = createAdminClient();

  // Load credentials from Supabase
  const { data: creds, error } = await supabase
    .from('amazon_credentials')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !creds?.refresh_token) {
    throw new Error(
      'Amazon Ads is not connected. Go to Settings to connect your account.'
    );
  }

  // Use stored access token if still valid
  if (creds.access_token && creds.access_token_expires_at) {
    const expiresAt = new Date(creds.access_token_expires_at).getTime();
    if (expiresAt - now > 60_000) {
      memCache = { accessToken: creds.access_token, expiresAt };
      return creds.access_token;
    }
  }

  // Access token expired — refresh it
  const clientId = process.env.AMAZON_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
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
    throw new Error(`Amazon token refresh failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const newExpiresAt = now + data.expires_in * 1000;

  // Persist refreshed access token to Supabase
  await supabase
    .from('amazon_credentials')
    .update({
      access_token: data.access_token,
      access_token_expires_at: new Date(newExpiresAt).toISOString(),
    })
    .eq('id', 1);

  // Update in-memory cache
  memCache = { accessToken: data.access_token, expiresAt: newExpiresAt };

  return data.access_token;
}
