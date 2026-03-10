/**
 * Admin API wrappers for content training management
 */
import type { ContentExample, CategoryGuidelines } from '../types/admin';

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

// ── Content Examples ──────────────────────────────────────────────────────────

export async function listContentExamples(filters?: {
  marketplace?: string;
  category_slug?: string;
  example_type?: string;
}): Promise<ContentExample[]> {
  const params = new URLSearchParams();
  if (filters?.marketplace) params.set('marketplace', filters.marketplace);
  if (filters?.category_slug) params.set('category_slug', filters.category_slug);
  if (filters?.example_type) params.set('example_type', filters.example_type);

  return apiFetch(`/admin/content-examples?${params.toString()}`);
}

export async function createContentExample(example: {
  marketplace: string;
  category_slug: string | null;
  example_type: string;
  language: string;
  content: string;
  reason: string;
  rating: number;
}): Promise<ContentExample> {
  return apiFetch('/admin/content-examples', {
    method: 'POST',
    body: JSON.stringify(example),
  });
}

export async function updateContentExample(
  id: string,
  updates: { content?: string; reason?: string; rating?: number }
): Promise<ContentExample> {
  return apiFetch('/admin/content-examples', {
    method: 'PUT',
    body: JSON.stringify({ id, ...updates }),
  });
}

export async function deleteContentExample(id: string): Promise<void> {
  await apiFetch(`/admin/content-examples?id=${id}`, {
    method: 'DELETE',
  });
}

// ── Category Guidelines ───────────────────────────────────────────────────────

export async function listCategoryGuidelines(
  bolCustomerId?: string
): Promise<CategoryGuidelines[]> {
  const params = new URLSearchParams();
  if (bolCustomerId) params.set('bol_customer_id', bolCustomerId);

  return apiFetch(`/admin/category-guidelines?${params.toString()}`);
}

export async function updateCategoryGuidelines(
  id: string,
  updates: {
    content_focus_areas?: string[];
    tone_guidelines?: string | null;
    priority_usps?: string[];
    attribute_templates?: Record<string, string>;
  }
): Promise<CategoryGuidelines> {
  return apiFetch('/admin/category-guidelines', {
    method: 'PUT',
    body: JSON.stringify({ id, ...updates }),
  });
}
