/**
 * Frontend helpers for the bol.com API endpoints.
 * All calls go through /api/* Vercel functions.
 */
import type { BolCustomer, BolAnalysis, BolCustomerAnalysisSummary } from '../types/bol';

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

  const content   = latest('content');
  const inventory = latest('inventory');
  const orders    = latest('orders');

  const scores = [content?.score, inventory?.score, orders?.score].filter(s => s != null) as number[];
  const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return { customer, content, inventory, orders, overall_score: overall, last_sync_at: customer.last_sync_at };
}
