import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

/**
 * PATCH /api/proposal
 * Update proposal status (approve, reject, execute).
 * Execution fires the n8n webhook.
 */
interface ProposalUpdateBody {
  proposalId: string;
  action: 'approve' | 'reject' | 'execute';
  reviewedBy: string; // user_id
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { proposalId, action, reviewedBy }: ProposalUpdateBody = req.body;

  if (!proposalId || !action || !reviewedBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const supabase = createAdminClient();

    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      execute: 'executed',
    };

    const newStatus = statusMap[action];
    if (!newStatus) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    };

    if (action === 'execute') {
      updateData.executed_at = new Date().toISOString();
    }

    const { data: proposal, error } = await supabase
      .from('optimization_proposals')
      .update(updateData)
      .eq('id', proposalId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Fire n8n webhook on execute
    if (action === 'execute') {
      const webhookUrl = process.env.N8N_PROPOSAL_WEBHOOK_URL;
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proposal,
              triggeredAt: new Date().toISOString(),
            }),
          });
        } catch (webhookErr) {
          // Log but don't fail — execution status is already saved
          console.error('[proposal] n8n webhook error:', webhookErr);
        }
      }
    }

    return res.status(200).json({ proposal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[proposal]', message);
    return res.status(500).json({ error: message });
  }
}
