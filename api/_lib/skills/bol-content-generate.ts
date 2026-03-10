/**
 * Bol Content Generation Skill
 * Generates AI-optimized SEO content for Bol.com products
 * Can be invoked from UI or chat (future)
 */
import { createAdminClient } from '../supabase-admin.js';
import { fetchContentGenerationContext, saveContentProposal } from '../bol-content-helpers.js';
import {
  buildContentOptimizationPrompt,
  parseClaudeResponse,
  calculateChangesSummary,
} from '../bol-content-prompts.js';
import {
  buildDatabasePrompt,
  updatePromptPerformance,
} from '../bol-content-prompt-builder.js';
import Anthropic from '@anthropic-ai/sdk';
import type { BolContentProposal } from '../../../src/types/bol.js';

// ── Type Definitions ──────────────────────────────────────────────────────────

export interface BolContentGenerateInput {
  customer_id: string;
  ean: string;
  trigger_reason?: 'manual' | 'quality_score' | 'keyword_trend';
}

export interface BolContentGenerateResult {
  success: boolean;
  proposal?: BolContentProposal;
  reasoning?: string;
  estimated_improvement_pct?: number;
  error?: string;
}

// ── Skill Execution ───────────────────────────────────────────────────────────

/**
 * Execute the bol_content_generate skill
 * This is the main entry point that can be called from UI or chat
 */
export async function executeBolContentGenerate(
  input: BolContentGenerateInput
): Promise<BolContentGenerateResult> {
  const supabase = createAdminClient();

  console.log(`[bol_content_generate] Starting for EAN ${input.ean}, customer ${input.customer_id}`);

  try {
    // Step 1: Fetch context data
    const context = await fetchContentGenerationContext(
      input.customer_id,
      input.ean,
      supabase
    );

    if ('error' in context) {
      console.log(`[bol_content_generate] Context fetch failed: ${context.error}`);
      return { success: false, error: context.error };
    }

    console.log(`[bol_content_generate] Context fetched: ${context.keywords.length} keywords`);

    // Step 2: Build prompt (from database version or fallback to hardcoded)
    const { prompt, versionId } = await buildDatabasePrompt(context, input.customer_id);

    console.log(`[bol_content_generate] Using prompt version: ${versionId || 'fallback'}`);


    // Step 3: Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    console.log('[bol_content_generate] Calling Claude API...');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawResponse = message.content[0].type === 'text' ? message.content[0].text : '';

    console.log(`[bol_content_generate] Claude response received (${rawResponse.length} chars)`);

    // Step 4: Parse response
    const parsed = parseClaudeResponse(rawResponse);

    if (!parsed) {
      console.error('[bol_content_generate] Failed to parse Claude response');
      return {
        success: false,
        error: 'Failed to parse Claude response. Response: ' + rawResponse.slice(0, 200)
      };
    }

    console.log(`[bol_content_generate] Parsed content: title=${parsed.title.length} chars, desc=${parsed.description.length} chars`);

    // Step 5: Calculate changes
    const changesSummary = calculateChangesSummary(
      context.product.title || '',
      context.product.description || '',
      parsed.title,
      parsed.description,
      parsed.keywords_used || [],
      context.keywords as any[]
    );

    console.log(`[bol_content_generate] Changes: +${changesSummary.keywords_added.length} keywords, title_changed=${changesSummary.title_changed}`);

    // Step 6: Save proposal (with prompt version tracking)
    const proposal = await saveContentProposal(
      input.customer_id,
      input.ean,
      context,
      parsed,
      changesSummary,
      input.trigger_reason || 'manual',
      supabase,
      versionId
    );

    console.log(`[bol_content_generate] Proposal saved: ${proposal.id}`);

    // Step 7: Update performance metrics (if version was used)
    if (versionId) {
      await updatePromptPerformance(
        versionId,
        parsed.title.length,
        parsed.description.length,
        changesSummary.keywords_added.length
      );
      console.log(`[bol_content_generate] Performance metrics updated for version ${versionId}`);
    }

    return {
      success: true,
      proposal,
      reasoning: parsed.reasoning || '',
      estimated_improvement_pct: (proposal.score_after_estimate || 0) - (proposal.score_before || 0),
    };

  } catch (err: any) {
    console.error('[bol_content_generate] Error:', err);
    return {
      success: false,
      error: err.message || 'Unknown error during content generation'
    };
  }
}
