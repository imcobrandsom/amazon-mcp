import type { VercelRequest, VercelResponse } from '@vercel/node';

// Absolute minimal test - no dependencies
export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    test: 'minimal',
    timestamp: new Date().toISOString(),
    method: req.method,
    headers: Object.keys(req.headers),
  });
}
