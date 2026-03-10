/**
 * POST /api/skill-invoke
 * Universal skill invocation endpoint
 * Routes skill requests to appropriate skill handlers
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  executeBolContentGenerate,
  type BolContentGenerateInput,
} from './_lib/skills/bol-content-generate.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { skillName, input } = req.body as {
    skillName: string;
    input: Record<string, unknown>;
  };

  if (!skillName) {
    return res.status(400).json({ error: 'skillName required' });
  }

  console.log(`[skill-invoke] Invoking skill: ${skillName}`);

  try {
    // Route to appropriate skill handler
    switch (skillName) {
      case 'bol_content_generate':
        const result = await executeBolContentGenerate(input as BolContentGenerateInput);
        return res.status(200).json(result);

      default:
        console.log(`[skill-invoke] Unknown skill: ${skillName}`);
        return res.status(400).json({ error: `Unknown skill: ${skillName}` });
    }

  } catch (err: any) {
    console.error('[skill-invoke] Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Skill execution failed'
    });
  }
}
