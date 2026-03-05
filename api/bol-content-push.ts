import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { proposalId } = req.body;
  if (!proposalId || typeof proposalId !== 'string') {
    return res.status(400).json({ error: 'proposalId required' });
  }

  const supabase = createAdminClient();

  try {
    // Update proposal status to 'pushed' (optimistic for UI)
    const { data, error } = await supabase
      .from('bol_content_proposals')
      .update({
        status: 'pushed',
        pushed_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Return success with placeholder message
    return res.status(200).json({
      success: false,
      message: 'Bol.com write API not yet configured. Content is approved and ready.',
      proposal: data,
    });
  } catch (error: any) {
    console.error('Push error:', error);
    return res.status(500).json({ error: error.message ?? 'Push failed' });
  }
}
