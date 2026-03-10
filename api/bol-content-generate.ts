/**
 * POST /api/bol-content-generate
 * DEPRECATED: Use /api/skill-invoke with skillName: 'bol_content_generate' instead
 *
 * Kept for backwards compatibility - internally delegates to skill system
 * Phase 2.5: Refactored to use skill-based architecture
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeBolContentGenerate } from './_lib/skills/bol-content-generate.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { customerId, ean, trigger_reason = 'manual' } = req.body;

  if (!customerId || !ean) {
    return res.status(400).json({ error: 'customerId and ean required' });
  }

  console.log('[bol-content-generate] Delegating to skill system...');

  try {
    // Delegate to skill handler
    const result = await executeBolContentGenerate({
      customer_id: customerId,
      ean,
      trigger_reason,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Return in old API format for backwards compatibility
    return res.status(200).json({
      message: 'Content proposal generated successfully',
      proposal_id: result.proposal?.id,
      proposal: {
        ...result.proposal,
        reasoning: result.reasoning,
      },
      estimated_improvement_pct: result.estimated_improvement_pct,
    });

  } catch (error) {
    console.error('[bol-content-generate] Error:', error);
    return res.status(500).json({
      error: 'Content generation failed',
      details: (error as Error).message,
    });
  }
}
