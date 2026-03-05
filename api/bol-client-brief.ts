import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET: fetch brief
  if (req.method === 'GET') {
    const { customerId } = req.query;
    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }

    const { data, error } = await supabase
      .from('bol_client_brief')
      .select('*')
      .eq('bol_customer_id', customerId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return empty brief if none exists
    return res.status(200).json(data ?? { brief_text: '' });
  }

  // PUT: upsert brief
  if (req.method === 'PUT') {
    const { customerId, brief_text } = req.body;
    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }
    if (typeof brief_text !== 'string') {
      return res.status(400).json({ error: 'brief_text must be a string' });
    }

    const { data, error } = await supabase
      .from('bol_client_brief')
      .upsert(
        {
          bol_customer_id: customerId,
          brief_text,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'bol_customer_id' }
      )
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
