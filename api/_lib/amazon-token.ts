/**
 * Amazon Ads OAuth2 token management
 * Handles access token refresh and caching.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp ms
}

let tokenCache: TokenCache | null = null;

export async function getAmazonAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if valid (with 60s buffer)
  if (tokenCache && tokenCache.expiresAt - now > 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.AMAZON_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET!;
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN!;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Amazon OAuth environment variables');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}
