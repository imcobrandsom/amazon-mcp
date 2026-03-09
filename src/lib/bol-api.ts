/**
 * Frontend helpers for the bol.com API endpoints.
 * All calls go through /api/* Vercel functions.
 */
import type {
  BolCustomer,
  BolAnalysis,
  BolCustomerAnalysisSummary,
  BolCompetitorSnapshot,
  BolKeywordRanking,
  BolProduct,
  BolCampaignPerformance,
  BolKeywordPerformance,
  BolCampaignChartPoint,
  BolCategoryInsights,
  BolCompetitorCatalog,
  BolKeywordCategory,
  BolKeywordOverviewItem,
  BolContentProposal,
  BolContentTrend,
  BolClientBrief,
  BolProductAnalysisResponse,
  BolProductKeywordTarget,
  BolCustomerSettings,
  BolProductPriorityQueueItem,
} from '../types/bol';
import { supabase } from './supabase';

const BASE = '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Customers ─────────────────────────────────────────────────────────────────

export function listBolCustomers(): Promise<{ customers: BolCustomer[] }> {
  return apiFetch('/bol-customers');
}

export function createBolCustomer(data: {
  seller_name: string;
  bol_client_id: string;
  bol_client_secret: string;
  client_id?: string;
  sync_interval_hours?: number;
}): Promise<{ customer: BolCustomer }> {
  return apiFetch('/bol-customers', { method: 'POST', body: JSON.stringify(data) });
}

export function updateBolCustomer(
  id: string,
  updates: Partial<Pick<BolCustomer, 'seller_name' | 'active' | 'client_id' | 'sync_interval_hours'>> & { bol_client_secret?: string }
): Promise<{ customer: BolCustomer }> {
  return apiFetch('/bol-customers', { method: 'PATCH', body: JSON.stringify({ id, ...updates }) });
}

// ── Manual sync trigger ───────────────────────────────────────────────────────

export function triggerManualSync(
  customerId: string,
  webhookSecret: string
): Promise<Record<string, unknown>> {
  return apiFetch('/bol-sync-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': webhookSecret },
    body: JSON.stringify({ customerId }),
  });
}

// ── Analyses (read from Supabase directly via this helper) ────────────────────

export async function getBolSummaryForClient(clientId: string): Promise<BolCustomerAnalysisSummary | null> {
  // Fetch the bol customer linked to this Follo client
  const { customers } = await listBolCustomers();
  const customer = customers.find(c => c.client_id === clientId);
  if (!customer) return null;

  // Fetch latest analysis per category
  const res = await apiFetch<{ analyses: BolAnalysis[] }>(
    `/bol-analyses?customerId=${customer.id}`
  );

  const latest = (category: BolAnalysis['category']) =>
    res.analyses
      .filter(a => a.category === category)
      .sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime())[0] ?? null;

  const content     = latest('content');
  const inventory   = latest('inventory');
  const orders      = latest('orders');
  const advertising = latest('advertising');
  const returns     = latest('returns');
  const performance = latest('performance');

  // Weighted overall score (only include categories with data)
  const scoreInputs: Record<string, number> = {};
  if (content?.score     !== undefined) scoreInputs.content     = content.score;
  if (inventory?.score   !== undefined) scoreInputs.inventory   = inventory.score;
  if (orders?.score      !== undefined) scoreInputs.orders      = orders.score;
  if (advertising?.score !== undefined) scoreInputs.advertising = advertising.score;
  if (returns?.score     !== undefined) scoreInputs.returns     = returns.score;
  if (performance?.score !== undefined) scoreInputs.performance = performance.score;

  const weights: Record<string, number> = {
    content: 0.30, inventory: 0.25, orders: 0.20,
    advertising: 0.15, returns: 0.05, performance: 0.05,
  };
  let weighted = 0, totalWeight = 0;
  for (const [key, w] of Object.entries(weights)) {
    const s = scoreInputs[key];
    if (s !== undefined) { weighted += s * w; totalWeight += w; }
  }
  const overall = totalWeight > 0 ? Math.round(weighted / totalWeight) : null;

  return {
    customer,
    content,
    inventory,
    orders,
    advertising,
    returns,
    performance,
    overall_score: overall,
    last_sync_at: customer.last_sync_at,
  };
}

// ── Campaign + keyword time-series ────────────────────────────────────────────

export function getBolCampaignsForClient(
  customerId: string,
  dateRange?: { from: string; to: string }
): Promise<{
  campaigns: BolCampaignPerformance[];
  keywords: BolKeywordPerformance[];
  count: number;
}> {
  let url = `/bol-campaigns?customerId=${customerId}`;
  if (dateRange) {
    url += `&from=${dateRange.from}&to=${dateRange.to}`;
  }
  return apiFetch(url);
}

// ── Campaign chart (daily aggregated time-series) ─────────────────────────────

export function getBolCampaignChart(
  customerId: string,
  daysOrDateRange: number | { from: string; to: string }
): Promise<{
  points: BolCampaignChartPoint[];
}> {
  if (typeof daysOrDateRange === 'number') {
    return apiFetch(`/bol-campaigns-chart?customerId=${customerId}&days=${daysOrDateRange}`);
  } else {
    return apiFetch(
      `/bol-campaigns-chart?customerId=${customerId}&from=${daysOrDateRange.from}&to=${daysOrDateRange.to}`
    );
  }
}

// ── Products (inventory + listings join) ──────────────────────────────────────

export function getBolProducts(customerId: string): Promise<{ products: BolProduct[] }> {
  return apiFetch(`/bol-products?customerId=${customerId}`);
}

export function updateProductMetadata(
  customerId: string,
  ean: string,
  eol: boolean
): Promise<{ success: boolean; data?: unknown }> {
  return apiFetch('/bol-product-metadata', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId, ean, eol }),
  });
}

// ── Competitor data ───────────────────────────────────────────────────────────

export async function getBolCompetitorsForClient(
  customerId: string
): Promise<{ competitors: BolCompetitorSnapshot[]; count: number }> {
  return apiFetch(`/bol-competitors?customerId=${customerId}`);
}

// ── Keyword ranking data ──────────────────────────────────────────────────────

// Oude EAN-gerichte interface (deprecated, behoud voor backwards compat)
export async function getBolKeywordsForClient(
  customerId: string
): Promise<{ rankings: BolKeywordRanking[]; count: number }> {
  return apiFetch(`/bol-keywords?customerId=${customerId}`);
}

// Nieuwe keyword-gerichte interfaces
export async function getBolKeywordOverview(
  customerId: string,
  categorySlug?: string
): Promise<{
  categories: Array<{
    category_slug: string;
    keywords: Array<{
      keyword: string;
      search_volume: number;
      volume_trend: 'up' | 'down' | 'stable' | 'new';
      week_of: string;
    }>;
  }>;
  total_rows: number;
}> {
  const params = new URLSearchParams({ customerId });
  if (categorySlug) params.append('categorySlug', categorySlug);
  return apiFetch(`/bol-keywords?${params}`);
}

export async function getBolKeywordDetail(
  customerId: string,
  keyword: string
): Promise<{
  keyword: string;
  history: Array<{
    keyword: string;
    category_slug: string;
    search_volume: number;
    week_of: string;
  }>;
}> {
  return apiFetch(`/bol-keywords?customerId=${customerId}&keyword=${encodeURIComponent(keyword)}`);
}

// ── Competitor research data ──────────────────────────────────────────────────

export async function getBolCategoryInsights(
  customerId: string,
  categorySlug?: string
): Promise<{ insights: BolCategoryInsights | BolCategoryInsights[] | null }> {
  const params = new URLSearchParams({ customerId });
  if (categorySlug) params.append('categorySlug', categorySlug);
  return apiFetch(`/bol-category-insights?${params}`);
}

export async function getBolCompetitorCatalog(
  customerId: string,
  categorySlug: string,
  limit = 100
): Promise<{ competitors: BolCompetitorCatalog[]; count: number }> {
  const params = new URLSearchParams({
    customerId,
    categorySlug,
    limit: limit.toString(),
  });
  return apiFetch(`/bol-competitor-catalog?${params}`);
}

// ── Dashboard-initiated sync ──────────────────────────────────────────────────

export type BolSyncType = 'main' | 'complete' | 'competitor' | 'ads';

export interface BolSyncResult {
  customer_id?: string;
  seller_name?: string;
  started_at?: string;
  duration_ms?: number;
  // main
  offers_export?: { status: string; process_status_id?: string; note?: string; error?: string };
  inventory?:     { status: string; items?: number;     score?: number; error?: string };
  orders?:        { status: string; count?: number;     score?: number; error?: string };
  advertising?:   { status: string; campaigns?: number; score?: number; note?: string; error?: string };
  returns?:       { status: string; open?: number; handled?: number; score?: number; error?: string };
  performance?:   { status: string; indicators?: number; score?: number; error?: string };
  // complete
  checked?: number;
  completed?: number;
  still_pending?: number;
  results?: Array<{ jobId: string; status: string; detail: string }>;
  // extended
  detail?: { competitors?: string; rankings?: string; catalog?: string; categories_detected?: string; unique_categories?: string };
  // competitor analysis
  categories_detected?: number;
  categories_processed?: number;
  categories_analyzed?: number;
  competitors_found?: number;
  insights_generated?: number;
  keywords_analyzed?: number;
  // common
  error?: string;
  message?: string;
}

/**
 * Trigger a sync phase from the dashboard UI.
 * Uses the current Supabase session JWT for auth.
 */
export async function triggerSync(
  customerId: string,
  syncType: BolSyncType,
): Promise<BolSyncResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated — please sign in again');
  }

  const res = await fetch(`${BASE}/bol-sync-trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ customerId, syncType }),
  });

  const data = await res.json() as BolSyncResult;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Keyword Intelligence API ──────────────────────────────────────────────────

/**
 * Extract high-value keywords from competitor content using AI
 */
export async function extractCompetitorKeywords(
  customerId: string,
  limit = 20
): Promise<{
  message: string;
  products_analyzed: number;
  keywords_added: number;
  results: Array<{ ean: string; keywords_added: number; keywords: string[] }>;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated — please sign in again');
  }

  const res = await fetch(`${BASE}/bol-keywords-competitor-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ customerId, limit }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Content Generator API ─────────────────────────────────────────────────────

export async function getBolContentProposals(customerId: string, ean?: string) {
  const params = new URLSearchParams({ customerId });
  if (ean) params.set('ean', ean);
  const r = await fetch(`${BASE}/bol-content-proposals?${params}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function generateBolContent(
  customerId: string,
  ean: string,
  triggerReason: 'manual' | 'quality_score' | 'keyword_trend' = 'manual'
): Promise<{
  proposal: BolContentProposal;
  reasoning: string;
  estimated_improvement_pct: number;
}> {
  return apiFetch('/bol-content-generate', {
    method: 'POST',
    body: JSON.stringify({ customerId, ean, trigger_reason: triggerReason }),
  });
}

export async function approveContentProposal(
  proposalId: string,
  customerId: string
): Promise<{
  message: string;
  proposal: BolContentProposal;
  auto_pushed: boolean;
}> {
  return apiFetch('/bol-content-approve', {
    method: 'POST',
    body: JSON.stringify({ proposalId, customerId }),
  });
}

export async function rejectContentProposal(
  proposalId: string,
  customerId: string,
  reason?: string
): Promise<{
  message: string;
  proposal: BolContentProposal;
}> {
  return apiFetch('/bol-content-reject', {
    method: 'POST',
    body: JSON.stringify({ proposalId, customerId, reason }),
  });
}

export async function pushContentToBol(
  proposalId: string,
  customerId: string
): Promise<{
  message: string;
  proposal_id: string;
  ean: string;
  offer_id: string;
  snapshot_created: boolean;
}> {
  return apiFetch('/bol-content-push', {
    method: 'POST',
    body: JSON.stringify({ proposalId, customerId }),
  });
}

export async function getClientBrief(customerId: string) {
  const r = await fetch(`${BASE}/bol-client-brief?customerId=${customerId}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveClientBrief(customerId: string, brief_text: string) {
  const r = await fetch(`${BASE}/bol-client-brief`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId, brief_text }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getContentTrends(customerId: string) {
  const r = await fetch(`${BASE}/bol-content-trends?customerId=${customerId}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadContentBase(customerId: string, file: File): Promise<{ uploaded: number; skipped: number; errors: string[] }> {
  // Convert file to base64
  const fileData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      // Remove data:...;base64, prefix
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const r = await fetch(`${BASE}/bol-content-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId,
      fileData,
      filename: file.name,
    }),
  });

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Content Intelligence (Phase 1) ────────────────────────────────────────

export async function getBolProductAnalysis(
  customerId: string,
  ean: string
): Promise<BolProductAnalysisResponse> {
  return apiFetch(`/bol-product-analysis?customerId=${customerId}&ean=${encodeURIComponent(ean)}`);
}

/**
 * DEPRECATED: Use enrichKeywords instead
 * Old endpoint for populating keywords from advertising campaigns only
 */
export async function populateKeywordsFromAds(customerId: string): Promise<{
  message: string;
  campaigns_processed: number;
  ad_groups_processed: number;
  keywords_found: number;
  keyword_product_mappings: number;
  unique_keywords_inserted: number;
  note: string;
}> {
  return apiFetch(`/bol-keywords-populate`, {
    method: 'POST',
    body: JSON.stringify({ customerId }),
  });
}

export async function triggerKeywordSync(customerId: string): Promise<{
  message: string;
  total: number;
  updated: number;
  errors: number;
}> {
  return apiFetch(`/bol-keyword-sync`, {
    method: 'POST',
    body: JSON.stringify({ customerId }),
  });
}

/**
 * Phase 2: Comprehensive keyword enrichment
 * Combines AI content extraction + advertising mapping + search volume + category fallbacks + metadata sync
 */
export async function enrichKeywords(customerId: string): Promise<{
  message: string;
  stats: {
    products_analyzed: number;
    ai_keywords_extracted: number;
    advertising_keywords_mapped: number;
    category_fallbacks_added: number;
    search_volumes_fetched: number;
    total_keywords_inserted: number;
  };
  keywords_by_source?: {
    ai_extraction: number;
    advertising: number;
    category_fallback: number;
  };
}> {
  return apiFetch(`/bol-keywords-enrich`, {
    method: 'POST',
    body: JSON.stringify({ customerId }),
  });
}

export async function getCustomerSettings(customerId: string): Promise<BolCustomerSettings | null> {
  const { data } = await supabase
    .from('bol_customer_settings')
    .select('*')
    .eq('bol_customer_id', customerId)
    .single();
  return data;
}

export async function updateCustomerSettings(
  customerId: string,
  settings: Partial<BolCustomerSettings>
): Promise<void> {
  const { error } = await supabase
    .from('bol_customer_settings')
    .upsert({
      bol_customer_id: customerId,
      ...settings,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
}

export async function getPriorityQueue(
  customerId: string
): Promise<{ products: BolProductPriorityQueueItem[] }> {
  const { data, error } = await supabase
    .from('bol_product_priority_queue')
    .select('*')
    .eq('bol_customer_id', customerId)
    .order('priority_score', { ascending: false })
    .limit(50);

  if (error) throw error;
  return { products: data ?? [] };
}
