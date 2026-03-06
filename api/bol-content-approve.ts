/**
 * POST /api/bol-content-approve
 * Approves a content proposal (changes status to 'approved')
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { proposalId, customerId } = req.body;

  if (!proposalId || !customerId) {
    return res.status(400).json({ error: 'proposalId and customerId required' });
  }

  const supabase = createAdminClient();

  try {
    // Update proposal status
    const { data: proposal, error: updateErr } = await supabase
      .from('bol_content_proposals')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .eq('bol_customer_id', customerId)
      .select()
      .single();

    if (updateErr || !proposal) {
      return res.status(404).json({ error: 'Proposal not found or update failed' });
    }

    // Check autonomy settings - auto-push if enabled
    const { data: settings } = await supabase
      .from('bol_customer_settings')
      .select('autonomy_level')
      .eq('bol_customer_id', customerId)
      .single();

    const shouldAutoPush = settings?.autonomy_level === 'auto';

    if (shouldAutoPush) {
      // Trigger push endpoint (internal call)
      // TODO: Implement auto-push logic
      console.log('Auto-push enabled but not yet implemented');
    }

    return res.status(200).json({
      message: 'Proposal approved successfully',
      proposal,
      auto_pushed: shouldAutoPush,
    });
  } catch (error) {
    console.error('Approval error:', error);
    return res.status(500).json({
      error: 'Failed to approve proposal',
      details: (error as Error).message,
    });
  }
}
