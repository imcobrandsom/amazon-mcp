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

export function getBolCampaignsForClient(customerId: string): Promise<{
  campaigns: BolCampaignPerformance[];
  keywords: BolKeywordPerformance[];
  count: number;
}> {
  return apiFetch(`/bol-campaigns?customerId=${customerId}`);
}

// ── Campaign chart (daily aggregated time-series) ─────────────────────────────

export function getBolCampaignChart(customerId: string, days: 7 | 14 | 30 | 90): Promise<{
  points: BolCampaignChartPoint[];
}> {
  return apiFetch(`/bol-campaigns-chart?customerId=${customerId}&days=${days}`);
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

export async function getBolKeywordsForClient(
  customerId: string
): Promise<{ rankings: BolKeywordRanking[]; count: number }> {
  return apiFetch(`/bol-keywords?customerId=${customerId}`);
}

// ── Dashboard-initiated sync ──────────────────────────────────────────────────

export type BolSyncType = 'main' | 'complete' | 'extended';

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
  detail?: { competitors?: string; rankings?: string; catalog?: string };
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
