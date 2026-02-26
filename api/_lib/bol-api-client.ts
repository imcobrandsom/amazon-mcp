/**
 * Bol.com Retailer API v10 Client
 * Handles OAuth2, rate limiting, async export pattern, and key endpoints.
 */

const BOL_API_BASE  = 'https://api.bol.com';
const BOL_ADS_BASE  = 'https://advertising.bol.com';
const BOL_TOKEN_URL = 'https://login.bol.com/token?grant_type=client_credentials';
const BOL_HEADERS   = { 'Accept': 'application/vnd.retailer.v10+json', 'Content-Type': 'application/vnd.retailer.v10+json' };
const BOL_ADS_HEADERS = { 'Accept': 'application/json', 'Content-Type': 'application/json' };

// ── Per-customer token cache (module-level, ~15 min lifetime per Vercel instance) ──────
interface CachedToken { token: string; expiresAt: number }
const tokenCache    = new Map<string, CachedToken>(); // Retailer API
const adsTokenCache = new Map<string, CachedToken>(); // Advertising API

/** Sleep helper for rate-limit spacing */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fetch/cache a Retailer API OAuth2 token */
export async function getBolToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(BOL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bol.com OAuth failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(clientId, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
  return data.access_token;
}

/** Fetch/cache an Advertising API OAuth2 token (separate credentials) */
export async function getAdsToken(adsClientId: string, adsClientSecret: string): Promise<string> {
  const cached = adsTokenCache.get(adsClientId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const credentials = Buffer.from(`${adsClientId}:${adsClientSecret}`).toString('base64');
  const res = await fetch(BOL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bol.com Ads OAuth failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  adsTokenCache.set(adsClientId, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
  return data.access_token;
}

// ── Simple CSV parser (handles quoted fields) ─────────────────────────────────
function parseCSV(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))
  );
}

// ── API helper ────────────────────────────────────────────────────────────────
async function bolFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BOL_API_BASE}${path}`, {
    ...options,
    headers: { ...BOL_HEADERS, 'Authorization': `Bearer ${token}`, ...(options.headers ?? {}) },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
    throw new Error(`Rate limited by bol.com — retry after ${retryAfter}s`);
  }

  let data: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) data = await res.json();
  else if (ct.includes('csv') || ct.includes('text')) data = await res.text();
  else data = await res.text();

  return { ok: res.ok, status: res.status, data };
}

// ── Exported API methods ──────────────────────────────────────────────────────

/** Step 1 of async offers export: submit job, returns processStatusId */
export async function startOffersExport(token: string): Promise<string> {
  const res = await bolFetch(token, '/retailer/offers/export', {
    method: 'POST',
    body: JSON.stringify({ format: 'CSV' }),
  });
  if (!res.ok) throw new Error(`startOffersExport failed (${res.status}): ${JSON.stringify(res.data)}`);
  const d = res.data as { processStatusId: string };
  if (!d.processStatusId) throw new Error('No processStatusId in export response');
  return String(d.processStatusId);
}

/** Check async job status — returns { status, entityId } */
export async function checkProcessStatus(
  token: string,
  processStatusId: string
): Promise<{ status: string; entityId: string | null }> {
  const res = await bolFetch(token, `/shared/process-status/${processStatusId}`);
  if (!res.ok) throw new Error(`checkProcessStatus failed (${res.status}): ${JSON.stringify(res.data)}`);
  const d = res.data as { status: string; entityId?: string };
  return { status: d.status, entityId: d.entityId ?? null };
}

/** Step 2: download completed offers CSV, parse to records */
export async function downloadOffersExport(token: string, entityId: string): Promise<Record<string, string>[]> {
  const res = await fetch(`${BOL_API_BASE}/retailer/offers/export/${entityId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+csv',
    },
  });
  if (!res.ok) throw new Error(`downloadOffersExport failed (${res.status})`);
  const csv = await res.text();
  return parseCSV(csv);
}

/** Fetch inventory (synchronous) */
export async function getInventory(token: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;

  while (true) {
    const res = await bolFetch(token, `/retailer/inventory?page=${page}`);
    if (!res.ok) break;
    const d = res.data as { inventory?: unknown[] };
    const items = d.inventory ?? [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 50) break; // bol.com returns max 50 per page
    page++;
  }

  return all;
}

/** Fetch recent orders (synchronous, all fulfilment methods) — Bug fix: was FBR only */
export async function getOrders(token: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;

  while (true) {
    const res = await bolFetch(token, `/retailer/orders?fulfilment-method=ALL&status=ALL&page=${page}`);
    if (!res.ok) break;
    const d = res.data as { orders?: unknown[] };
    const items = d.orders ?? [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 50) break;
    page++;
  }

  return all;
}

/** Fetch offer performance insights for a list of offer IDs (includes Buy Box %, Visits) */
export async function getOfferInsights(token: string, offerIds: string[]): Promise<unknown[]> {
  if (offerIds.length === 0) return [];
  const ids = offerIds.slice(0, 20); // API max
  const params = ids.map(id => `offer-id=${encodeURIComponent(id)}`).join('&');
  const res = await bolFetch(
    token,
    `/retailer/insights/offer?${params}&period=MONTH&number-of-periods=1&name=IMPRESSIONS&name=CLICKS&name=CONVERSIONS&name=BUY_BOX_PERCENTAGE&name=PRODUCT_VISITS`
  );
  if (!res.ok) return [];
  const d = res.data as { offerInsights?: unknown[] };
  return d.offerInsights ?? [];
}

// ── Returns ───────────────────────────────────────────────────────────────────

/** Fetch returns (open or handled, paginated) */
export async function getReturns(token: string, handled: boolean): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;

  while (true) {
    const res = await bolFetch(
      token,
      `/retailer/returns?fulfilment-method=ALL&handled=${handled}&page=${page}`
    );
    if (!res.ok) break;
    const d = res.data as { returns?: unknown[] };
    const items = d.returns ?? [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 50) break;
    page++;
  }

  return all;
}

// ── Performance indicators ────────────────────────────────────────────────────

/** Fetch a single official seller performance indicator for the current week */
export async function getPerformanceIndicator(
  token: string,
  name: 'CANCELLATION_RATE' | 'FULFILMENT_RATE' | 'REVIEW_SCORE'
): Promise<{ name: string; score: number | null; norm: number | null; status: string } | null> {
  // Use current ISO week — bol.com expects ?week=W&year=Y
  const now = new Date();
  // Calculate ISO week number
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = d.getUTCFullYear();

  const res = await bolFetch(
    token,
    `/retailer/insights/performance/indicator?name=${name}&week=${weekNo}&year=${year}`
  );
  if (!res.ok) return null;
  const d2 = res.data as { name?: string; score?: number; norm?: number; status?: string };
  return {
    name: d2.name ?? name,
    score: d2.score ?? null,
    norm: d2.norm ?? null,
    status: d2.status ?? 'UNKNOWN',
  };
}

// ── Competitor data ───────────────────────────────────────────────────────────

/** Fetch all competing offers for a given EAN */
export async function getCompetingOffers(token: string, ean: string): Promise<unknown[]> {
  const res = await bolFetch(
    token,
    `/retailer/products/${encodeURIComponent(ean)}/offers?include-refurbished-conditions=false`
  );
  if (!res.ok) return [];
  const d = res.data as { offers?: unknown[] };
  return d.offers ?? [];
}

/** Fetch product ratings (star rating + count) for a given EAN */
export async function getProductRatings(
  token: string,
  ean: string
): Promise<{ score: number; count: number } | null> {
  const res = await bolFetch(token, `/retailer/products/${encodeURIComponent(ean)}/ratings`);
  if (!res.ok) return null;
  const d = res.data as { rating?: number; totalRatingCount?: number };
  if (!d.rating) return null;
  return { score: d.rating, count: d.totalRatingCount ?? 0 };
}

// ── Keyword / ranking data ────────────────────────────────────────────────────

/** Fetch product search/browse rank history for a given EAN */
export async function getProductRanks(
  token: string,
  ean: string,
  searchType: 'SEARCH' | 'BROWSE'
): Promise<Array<{ rank: number; impressions: number; weekStartDate: string }>> {
  const res = await bolFetch(
    token,
    `/retailer/insights/product-ranks?ean=${encodeURIComponent(ean)}&search-type=${searchType}&number-of-weeks=4`
  );
  if (!res.ok) return [];
  const d = res.data as { productRanks?: Array<{ rank: number; impressions: number; weekStartDate: string }> };
  return d.productRanks ?? [];
}

// ── Catalog / content ─────────────────────────────────────────────────────────

/** Fetch full published catalog product data for a given EAN */
export async function getCatalogProduct(token: string, ean: string): Promise<unknown | null> {
  const res = await bolFetch(token, `/retailer/content/catalog-products/${encodeURIComponent(ean)}`);
  if (!res.ok) return null;
  return res.data;
}

/** Fetch sales forecast for an offer (predicted weekly sales volume) */
export async function getSalesForecast(
  token: string,
  offerId: string,
  weeksAhead = 4
): Promise<Array<{ week: string; amount: number }>> {
  const res = await bolFetch(
    token,
    `/retailer/insights/sales-forecast?offer-id=${encodeURIComponent(offerId)}&weeks-ahead=${weeksAhead}`
  );
  if (!res.ok) return [];
  const d = res.data as { weeklyForecast?: Array<{ week: string; amount: number }> };
  return d.weeklyForecast ?? [];
}

// ── Advertising API helpers ───────────────────────────────────────────────────

async function adsFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BOL_ADS_BASE}${path}`, {
    ...options,
    headers: { ...BOL_ADS_HEADERS, 'Authorization': `Bearer ${token}`, ...(options.headers ?? {}) },
  });

  let data: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) data = await res.json();
  else data = await res.text();

  return { ok: res.ok, status: res.status, data };
}

/** Fetch all ad campaigns */
export async function getAdsCampaigns(adsToken: string): Promise<unknown[]> {
  const res = await adsFetch(adsToken, '/api/v1/campaigns');
  if (!res.ok) throw new Error(`getAdsCampaigns failed (${res.status}): ${JSON.stringify(res.data)}`);
  const d = res.data as { campaigns?: unknown[] };
  return d.campaigns ?? [];
}

/** Fetch ad groups for a campaign */
export async function getAdsAdGroups(adsToken: string, campaignId: string): Promise<unknown[]> {
  const res = await adsFetch(adsToken, `/api/v1/campaigns/${campaignId}/ad-groups`);
  if (!res.ok) return [];
  const d = res.data as { adGroups?: unknown[] };
  return d.adGroups ?? [];
}

/** Fetch performance report for a date range (ISO dates: yyyy-MM-dd) */
export async function getAdsPerformance(
  adsToken: string,
  dateFrom: string,
  dateTo: string
): Promise<unknown[]> {
  const params = new URLSearchParams({ dateFrom, dateTo, groupBy: 'CAMPAIGN' });
  const res = await adsFetch(adsToken, `/api/v1/sponsored-products/performance-report?${params}`);
  if (!res.ok) return [];
  const d = res.data as { performanceReport?: unknown[] };
  return d.performanceReport ?? [];
}
