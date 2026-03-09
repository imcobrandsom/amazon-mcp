/**
 * POST /api/bol-keywords-enrich
 *
 * HTTP endpoint wrapper for keyword enrichment
 * Delegates to shared core logic in _lib/bol-keywords-enrich-core.ts
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { enrichKeywordsForCustomer } from './_lib/bol-keywords-enrich-core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  console.log('[bol-keywords-enrich] HTTP endpoint triggered for customer:', customerId);

  const result = await enrichKeywordsForCustomer(customerId);

  if (!result.success) {
    return res.status(500).json({
      error: result.error || 'Keyword enrichment failed',
      stats: result.stats,
    });
  }

  return res.status(200).json({
    message: 'Keyword enrichment completed successfully',
    stats: result.stats,
  });
}
