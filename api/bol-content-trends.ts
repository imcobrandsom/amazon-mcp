import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customerId } = req.query;
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'customerId required' });
  }

  const supabase = createAdminClient();

  try {
    // Fetch existing active trends (simplified - no auto-detection for now)
    const { data: existingTrends, error } = await supabase
      .from('bol_content_trends')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('is_acted_upon', false)
      .order('detected_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Return existing trends (trend detection can be added later when data is available)
    return res.status(200).json({ trends: existingTrends ?? [] });
  } catch (error: any) {
    console.error('Trend detection error:', error);
    return res.status(500).json({ error: error.message ?? 'Trend detection failed' });
  }
}
