/**
 * Admin API: Category Guidelines CRUD
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from '../_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET: List all category guidelines
  if (req.method === 'GET') {
    const { bol_customer_id } = req.query;

    let query = supabase
      .from('bol_category_attribute_requirements')
      .select('*')
      .order('category_slug', { ascending: true });

    if (bol_customer_id) {
      query = query.eq('bol_customer_id', bol_customer_id);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  // PUT: Update category guidelines
  if (req.method === 'PUT') {
    const {
      id,
      content_focus_areas,
      tone_guidelines,
      priority_usps,
      attribute_templates,
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const { data, error } = await supabase
      .from('bol_category_attribute_requirements')
      .update({
        content_focus_areas,
        tone_guidelines,
        priority_usps,
        attribute_templates,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
