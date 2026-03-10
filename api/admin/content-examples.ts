/**
 * Admin API: Content Examples CRUD
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from '../_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET: List all examples (with optional filters)
  if (req.method === 'GET') {
    const { marketplace, category_slug, example_type } = req.query;

    let query = supabase
      .from('content_examples')
      .select('*')
      .order('category_slug', { ascending: true })
      .order('example_type', { ascending: true })
      .order('rating', { ascending: false });

    if (marketplace) query = query.eq('marketplace', marketplace);
    if (category_slug) query = query.eq('category_slug', category_slug);
    if (example_type) query = query.eq('example_type', example_type);

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // POST: Create new example
  if (req.method === 'POST') {
    const { marketplace, category_slug, example_type, language, content, reason, rating } = req.body;

    const { data, error } = await supabase
      .from('content_examples')
      .insert({
        marketplace,
        category_slug: category_slug || null,
        example_type,
        language,
        content,
        reason,
        rating,
        created_by: 'admin',
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  }

  // PUT: Update example
  if (req.method === 'PUT') {
    const { id, content, reason, rating } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const { data, error } = await supabase
      .from('content_examples')
      .update({ content, reason, rating })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // DELETE: Remove example
  if (req.method === 'DELETE') {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const { error } = await supabase
      .from('content_examples')
      .delete()
      .eq('id', id as string);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
