/**
 * POST /api/bol-content-reject
 * Rejects a content proposal (changes status to 'rejected')
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { proposalId, customerId, reason } = req.body;

  if (!proposalId || !customerId) {
    return res.status(400).json({ error: 'proposalId and customerId required' });
  }

  const supabase = createAdminClient();

  try {
    const { data: proposal, error: updateErr } = await supabase
      .from('bol_content_proposals')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        // Store rejection reason in changes_summary if provided
        ...(reason && {
          changes_summary: {
            rejection_reason: reason,
          },
        }),
      })
      .eq('id', proposalId)
      .eq('bol_customer_id', customerId)
      .select()
      .single();

    if (updateErr || !proposal) {
      return res.status(404).json({ error: 'Proposal not found or update failed' });
    }

    return res.status(200).json({
      message: 'Proposal rejected successfully',
      proposal,
    });
  } catch (error) {
    console.error('Rejection error:', error);
    return res.status(500).json({
      error: 'Failed to reject proposal',
      details: (error as Error).message,
    });
  }
}
