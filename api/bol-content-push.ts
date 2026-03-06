/**
 * POST /api/bol-content-push
 * Pushes approved content to Bol.com via Retailer API
 * Creates 'before' performance snapshot
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getBolToken } from './_lib/bol-api-client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { proposalId, customerId } = req.body;

  if (!proposalId || !customerId) {
    return res.status(400).json({ error: 'proposalId and customerId required' });
  }

  const supabase = createAdminClient();

  try {
    // Fetch proposal
    const { data: proposal, error: proposalErr } = await supabase
      .from('bol_content_proposals')
      .select('*')
      .eq('id', proposalId)
      .eq('bol_customer_id', customerId)
      .single();

    if (proposalErr || !proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    if (proposal.status !== 'approved') {
      return res.status(400).json({
        error: 'Proposal must be approved before pushing',
        current_status: proposal.status,
      });
    }

    // Get customer credentials
    const { data: customer } = await supabase
      .from('bol_customers')
      .select('bol_client_id, bol_client_secret')
      .eq('id', customerId)
      .single();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

    // Get offer ID for this EAN
    const { data: listingSnap } = await supabase
      .from('bol_raw_snapshots')
      .select('raw_data')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'listings')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    const offers = ((listingSnap?.raw_data as any)?.offers as any[]) || [];
    const offer = offers.find((o: any) => o.ean === proposal.ean);

    if (!offer?.offerId) {
      return res.status(400).json({
        error: 'No offer ID found for this product',
        hint: 'Product may not be listed on Bol.com yet',
      });
    }

    // Push to Bol.com API
    // Note: Bol API endpoint for updating product content is:
    // PUT /retailer/content/offers/{offerId}
    console.log('Pushing content to Bol.com for offer:', offer.offerId);

    const bolResponse = await fetch(
      `https://api.bol.com/retailer/content/offers/${offer.offerId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.retailer.v10+json',
          'Content-Type': 'application/vnd.retailer.v10+json',
        },
        body: JSON.stringify({
          title: proposal.proposed_title,
          description: proposal.proposed_description,
        }),
      }
    );

    if (!bolResponse.ok) {
      const errorText = await bolResponse.text();
      throw new Error(`Bol API error (${bolResponse.status}): ${errorText}`);
    }

    // Update proposal status
    await supabase
      .from('bol_content_proposals')
      .update({
        status: 'pushed',
        pushed_at: new Date().toISOString(),
      })
      .eq('id', proposalId);

    // Create 'before' snapshot for performance tracking
    await supabase.rpc('create_before_snapshot', {
      p_proposal_id: proposalId,
      p_customer_id: customerId,
      p_ean: proposal.ean,
    });

    return res.status(200).json({
      message: 'Content pushed to Bol.com successfully',
      proposal_id: proposalId,
      ean: proposal.ean,
      offer_id: offer.offerId,
      snapshot_created: true,
    });
  } catch (error) {
    console.error('Push error:', error);

    // Mark proposal as push_failed (extend status enum if needed)
    await supabase
      .from('bol_content_proposals')
      .update({
        // Store error in changes_summary for now
        changes_summary: {
          ...(proposal?.changes_summary as any),
          push_error: (error as Error).message,
          push_error_at: new Date().toISOString(),
        },
      })
      .eq('id', proposalId);

    return res.status(500).json({
      error: 'Failed to push content',
      details: (error as Error).message,
    });
  }
}
