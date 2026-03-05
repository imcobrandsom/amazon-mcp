import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET: fetch proposals
  if (req.method === 'GET') {
    const { customerId, ean } = req.query;
    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }

    // If EAN provided: return full history for that EAN
    if (ean && typeof ean === 'string') {
      const { data, error } = await supabase
        .from('bol_content_proposals')
        .select('*')
        .eq('bol_customer_id', customerId)
        .eq('ean', ean)
        .order('generated_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ proposals: data ?? [] });
    }

    // Otherwise: return latest non-rejected proposal per EAN
    const { data: allProposals, error } = await supabase
      .from('bol_content_proposals')
      .select('*')
      .eq('bol_customer_id', customerId)
      .neq('status', 'rejected')
      .order('generated_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Deduplicate: keep only latest per EAN
    const latestByEan = new Map<string, any>();
    for (const p of allProposals ?? []) {
      if (!latestByEan.has(p.ean)) {
        latestByEan.set(p.ean, p);
      }
    }

    // Also check which EANs have basis content
    const { data: basisData, error: basisError } = await supabase
      .from('bol_content_base')
      .select('ean')
      .eq('bol_customer_id', customerId);

    if (basisError) {
      return res.status(500).json({ error: basisError.message });
    }

    const basisSet = new Set((basisData ?? []).map(b => b.ean));
    const basisCoverage: Record<string, boolean> = {};
    for (const ean of basisSet) {
      basisCoverage[ean] = true;
    }

    return res.status(200).json({
      proposals: Array.from(latestByEan.values()),
      basis_coverage: basisCoverage,
    });
  }

  // PATCH: approve or reject proposal
  if (req.method === 'PATCH') {
    const { proposalId, action } = req.body;
    if (!proposalId || typeof proposalId !== 'string') {
      return res.status(400).json({ error: 'proposalId required' });
    }
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const updates: any = {
      status: action === 'approve' ? 'approved' : 'rejected',
    };
    if (action === 'approve') {
      updates.approved_at = new Date().toISOString();
    } else {
      updates.rejected_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('bol_content_proposals')
      .update(updates)
      .eq('id', proposalId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
