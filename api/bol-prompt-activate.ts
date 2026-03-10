/**
 * POST /api/bol-prompt-activate
 * Activate a specific prompt version (deactivates others)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { versionId } = req.body;

  if (!versionId) {
    return res.status(400).json({ error: 'versionId required' });
  }

  const supabase = createAdminClient();

  console.log(`[bol-prompt-activate] Activating version ${versionId}`);

  try {
    // Call the activation function
    const { error } = await supabase.rpc('activate_prompt_version', {
      p_version_id: versionId,
    });

    if (error) {
      console.error('[bol-prompt-activate] Error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Get the activated version details
    const { data: version } = await supabase
      .from('bol_content_prompt_versions')
      .select('*')
      .eq('id', versionId)
      .single();

    return res.status(200).json({
      message: `Version ${version?.version_number} activated`,
      version,
    });

  } catch (err: any) {
    console.error('[bol-prompt-activate] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
