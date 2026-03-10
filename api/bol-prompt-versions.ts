/**
 * GET/POST /api/bol-prompt-versions
 * Manage content generation prompt versions
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createAdminClient();

  // GET: List all versions for a customer
  if (req.method === 'GET') {
    const { customerId } = req.query;

    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ error: 'customerId required' });
    }

    const { data: versions, error } = await supabase
      .from('bol_content_prompt_versions')
      .select('*')
      .eq('bol_customer_id', customerId)
      .order('version_number', { ascending: false });

    if (error) {
      console.error('[bol-prompt-versions] GET error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ versions });
  }

  // POST: Create new version
  if (req.method === 'POST') {
    const {
      customerId,
      versionName,
      systemInstructions,
      titleTemplate,
      descriptionTemplate,
      titleRules,
      descriptionRules,
      activate = false,
    } = req.body;

    if (!customerId || !systemInstructions) {
      return res.status(400).json({ error: 'customerId and systemInstructions required' });
    }

    // Get next version number
    const { data: latestVersion } = await supabase
      .from('bol_content_prompt_versions')
      .select('version_number')
      .eq('bol_customer_id', customerId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const nextVersionNumber = (latestVersion?.version_number || 0) + 1;

    // Insert new version
    const { data: newVersion, error: insertError } = await supabase
      .from('bol_content_prompt_versions')
      .insert({
        bol_customer_id: customerId,
        version_number: nextVersionNumber,
        version_name: versionName || `v${nextVersionNumber}`,
        is_active: false, // Will be activated separately if needed
        system_instructions: systemInstructions,
        title_template: titleTemplate || null,
        description_template: descriptionTemplate || null,
        title_rules: titleRules || undefined,
        description_rules: descriptionRules || undefined,
        created_by: 'admin', // TODO: get from auth context
      })
      .select()
      .single();

    if (insertError) {
      console.error('[bol-prompt-versions] POST error:', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    // Activate if requested
    if (activate && newVersion) {
      const { error: activateError } = await supabase.rpc('activate_prompt_version', {
        p_version_id: newVersion.id,
      });

      if (activateError) {
        console.error('[bol-prompt-versions] Activate error:', activateError);
      }
    }

    console.log(`[bol-prompt-versions] Created version ${nextVersionNumber} for customer ${customerId}`);

    return res.status(201).json({
      version: newVersion,
      message: `Version ${nextVersionNumber} created${activate ? ' and activated' : ''}`
    });
  }

  // PUT: Update existing version
  if (req.method === 'PUT') {
    const { versionId, ...updates } = req.body;

    if (!versionId) {
      return res.status(400).json({ error: 'versionId required' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('bol_content_prompt_versions')
      .update(updates)
      .eq('id', versionId)
      .select()
      .single();

    if (updateError) {
      console.error('[bol-prompt-versions] PUT error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({ version: updated });
  }

  // DELETE: Delete a version (only if not active)
  if (req.method === 'DELETE') {
    const { versionId } = req.query;

    if (!versionId || typeof versionId !== 'string') {
      return res.status(400).json({ error: 'versionId required' });
    }

    // Check if active
    const { data: version } = await supabase
      .from('bol_content_prompt_versions')
      .select('is_active')
      .eq('id', versionId)
      .single();

    if (version?.is_active) {
      return res.status(400).json({ error: 'Cannot delete active version. Activate another version first.' });
    }

    const { error: deleteError } = await supabase
      .from('bol_content_prompt_versions')
      .delete()
      .eq('id', versionId);

    if (deleteError) {
      console.error('[bol-prompt-versions] DELETE error:', deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({ message: 'Version deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
