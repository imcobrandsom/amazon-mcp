/**
 * GET /api/academy-articles - List all published articles (or all for admins)
 * POST /api/academy-articles - Create new article (admin only)
 * PUT /api/academy-articles - Update article (admin only)
 * DELETE /api/academy-articles?id=xxx - Delete article (admin only)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js.js';

interface AcademyArticle {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  category: string;
  subcategory: string | null;
  keywords: string | null;
  body: string;
  last_modified_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  is_published: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET - List articles
  if (req.method === 'GET') {
    // Check if user is admin (to see unpublished)
    const authHeader = req.headers.authorization;
    let isAdmin = false;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user) {
        const { data: roleData } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        isAdmin = roleData?.role === 'admin';
      }
    }

    let query = supabase.from('academy_articles').select('*');

    // Non-admins only see published
    if (!isAdmin) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query.order('category').order('title');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // All other methods require auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Check admin role
  const { data: roleData } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (roleData?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // POST - Create article
  if (req.method === 'POST') {
    const { title, subtitle, slug, category, subcategory, keywords, body, is_published } = req.body;

    if (!title || !slug || !category || !body) {
      return res.status(400).json({ error: 'Missing required fields: title, slug, category, body' });
    }

    const { data, error } = await supabase
      .from('academy_articles')
      .insert({
        title,
        subtitle: subtitle || null,
        slug,
        category,
        subcategory: subcategory || null,
        keywords: keywords || null,
        body,
        is_published: is_published ?? true,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  }

  // PUT - Update article
  if (req.method === 'PUT') {
    const { id, title, subtitle, slug, category, subcategory, keywords, body, is_published } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing article id' });
    }

    const updates: Partial<AcademyArticle> = { updated_by: user.id };
    if (title !== undefined) updates.title = title;
    if (subtitle !== undefined) updates.subtitle = subtitle;
    if (slug !== undefined) updates.slug = slug;
    if (category !== undefined) updates.category = category;
    if (subcategory !== undefined) updates.subcategory = subcategory;
    if (keywords !== undefined) updates.keywords = keywords;
    if (body !== undefined) updates.body = body;
    if (is_published !== undefined) updates.is_published = is_published;

    const { data, error } = await supabase
      .from('academy_articles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // DELETE - Delete article
  if (req.method === 'DELETE') {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Missing article id' });
    }

    const { error } = await supabase
      .from('academy_articles')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
