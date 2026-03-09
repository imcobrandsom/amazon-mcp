/**
 * POST /api/bol-keywords-ai-trigger
 * Manually trigger AI keyword extraction chain (dashboard button)
 *
 * Body: { customerId: string }
 *
 * This immediately starts the self-triggering chain for the specified customer.
 * Progress can be monitored via bol_ai_extraction_progress table.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  try {
    // Trigger the AI cron job with specific customer
    const host = req.headers.host || 'amazon-mcp-eight.vercel.app';

    console.log(`[ai-trigger] Starting AI extraction chain for customer ${customerId}`);

    // Don't await - fire and forget
    fetch(`https://${host}/api/bol-keywords-ai-cron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId }),
    }).catch(err => {
      console.error('[ai-trigger] Failed to trigger AI cron:', err.message);
    });

    return res.status(200).json({
      message: 'AI keyword extraction chain started',
      customerId,
      info: 'Processing will continue in batches of 10 products. Check bol_ai_extraction_progress for status.',
    });

  } catch (error) {
    console.error('[ai-trigger] Error:', error);
    return res.status(500).json({
      error: 'Failed to trigger AI extraction',
      details: (error as Error).message,
    });
  }
}
