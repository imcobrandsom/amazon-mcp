import type { AcademyArticle, JsonAcademyArticle } from '../types/academy';
import { supabase } from './supabase';

export async function fetchAcademyArticles(): Promise<AcademyArticle[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch('/api/academy-articles', { headers });
    if (!res.ok) {
      // Fallback to JSON if database not ready
      console.warn('Database not ready, falling back to JSON');
      return fetchJsonArticles();
    }
    return res.json();
  } catch (err) {
    console.warn('Failed to fetch from API, falling back to JSON:', err);
    return fetchJsonArticles();
  }
}

// Fallback: load from static JSON and transform to DB format
async function fetchJsonArticles(): Promise<AcademyArticle[]> {
  const res = await fetch('/academy-articles.json');
  if (!res.ok) throw new Error(`Failed to load JSON: HTTP ${res.status}`);
  const jsonArticles: JsonAcademyArticle[] = await res.json();

  // Transform JSON format to DB format
  return jsonArticles.map((a, idx) => ({
    id: `json-${idx}`, // Fake ID for JSON articles
    title: a.title,
    subtitle: a.subtitle || null,
    slug: a.slug,
    category: a.category || 'Overig',
    subcategory: a.subcategory || null,
    keywords: a.keywords || null,
    body: a.body,
    last_modified_date: a.lastModified || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: null,
    updated_by: null,
    is_published: true,
  }));
}

export async function createAcademyArticle(
  article: Omit<AcademyArticle, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>
): Promise<AcademyArticle> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/academy-articles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(article),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function updateAcademyArticle(
  id: string,
  updates: Partial<Omit<AcademyArticle, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>>
): Promise<AcademyArticle> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/academy-articles', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ id, ...updates }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function deleteAcademyArticle(id: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`/api/academy-articles?id=${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}
