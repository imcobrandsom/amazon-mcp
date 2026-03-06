/**
 * POST /api/bol-content-generate
 * Generates optimized content proposal for a product using Claude AI
 * Phase 2: Updated to use bol_product_keyword_targets and new prompt system
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import {
  buildContentOptimizationPrompt,
  parseClaudeResponse,
  calculateChangesSummary,
  type ContentGenerationContext,
} from './_lib/bol-content-prompts.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { customerId, ean, triggerReason = 'manual' } = req.body;

  if (!customerId || !ean) {
    return res.status(400).json({ error: 'customerId and ean required' });
  }

  const supabase = createAdminClient();

  try {
    // Step 1: Fetch product data
    const { data: productSnap } = await supabase
      .from('bol_raw_snapshots')
      .select('catalog_attributes')
      .eq('bol_customer_id', customerId)
      .eq('data_type', 'catalog')
      .eq('raw_data->>ean', ean)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (!productSnap?.catalog_attributes) {
      return res.status(404).json({ error: 'Product not found or no catalog data available' });
    }

    const catalogAttrs = productSnap.catalog_attributes as any;

    // Step 2: Fetch product category
    const { data: categoryData } = await supabase
      .from('bol_product_categories')
      .select('category_slug, category_path')
      .eq('bol_customer_id', customerId)
      .eq('ean', ean)
      .single();

    const categorySlug = categoryData?.category_slug || null;
    const categoryName = categoryData?.category_path?.split(' > ').pop() || null;

    // Step 3: Fetch target keywords
    const { data: keywords } = await supabase
      .from('bol_product_keyword_targets')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('ean', ean)
      .order('priority', { ascending: false });

    if (!keywords || keywords.length === 0) {
      return res.status(400).json({
        error: 'No target keywords found for this product',
        hint: 'Run /api/bol-keywords-populate first to add keywords'
      });
    }

    // Step 4: Fetch category requirements
    const { data: categoryReqs } = categorySlug
      ? await supabase
          .from('bol_category_attribute_requirements')
          .select('*')
          .eq('bol_customer_id', customerId)
          .eq('category_slug', categorySlug)
          .single()
      : { data: null };

    // Step 5: Fetch completeness data
    const { data: completenessData } = await supabase.rpc('get_product_completeness', {
      p_customer_id: customerId,
      p_ean: ean,
    });

    const completeness = completenessData?.[0] || null;

    // Step 6: Fetch client brief
    const { data: briefData } = await supabase
      .from('bol_client_brief')
      .select('brief_text')
      .eq('bol_customer_id', customerId)
      .single();

    // Step 7: Fetch competitor (optional)
    const { data: competitorData } = await supabase
      .from('bol_competitor_catalog')
      .select('*')
      .eq('bol_customer_id', customerId)
      .eq('category_slug', categorySlug || '')
      .order('relevance_score', { ascending: false })
      .limit(1)
      .single();

    // Step 8: Build prompt context
    const context: ContentGenerationContext = {
      product: {
        ean,
        title: catalogAttrs.Title || null,
        description: catalogAttrs.Description || null,
        category: categoryName,
        price: null, // TODO: fetch from listings if needed
        catalogAttributes: catalogAttrs,
      },
      keywords: keywords as any[],
      categoryRequirements: categoryReqs as any,
      clientBrief: briefData?.brief_text || null,
      competitor: competitorData || null,
      currentCompleteness: completeness,
    };

    const prompt = buildContentOptimizationPrompt(context);

    console.log('Calling Claude API for content generation...');

    // Step 9: Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const rawResponse = message.content[0].type === 'text' ? message.content[0].text : '';

    console.log('Claude response received:', rawResponse.substring(0, 200) + '...');

    // Step 10: Parse Claude response
    const parsed = parseClaudeResponse(rawResponse);

    if (!parsed) {
      return res.status(500).json({
        error: 'Failed to parse Claude response',
        raw: rawResponse,
      });
    }

    // Step 11: Calculate changes summary
    const changesSummary = calculateChangesSummary(
      context.product.title,
      context.product.description,
      parsed.title,
      parsed.description,
      parsed.keywords_used,
      context.keywords as any[]
    );

    // Step 12: Estimate score improvement (rough heuristic)
    const currentScore = completeness?.overall_completeness_score || 0;
    const scoreImprovement = Math.min(20, changesSummary.keywords_added.length * 5); // +5% per keyword, max +20%
    const estimatedScore = Math.min(100, currentScore + scoreImprovement);

    // Step 13: Save proposal to database
    const { data: proposal, error: insertErr } = await supabase
      .from('bol_content_proposals')
      .insert({
        bol_customer_id: customerId,
        ean,
        status: 'pending',
        trigger_reason: triggerReason,
        current_title: context.product.title,
        current_description: context.product.description,
        proposed_title: parsed.title,
        proposed_description: parsed.description,
        proposed_description_parts: parsed.description_parts,
        score_before: currentScore,
        score_after_estimate: estimatedScore,
        changes_summary: changesSummary,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to save proposal:', insertErr);
      return res.status(500).json({ error: 'Failed to save proposal', details: insertErr.message });
    }

    return res.status(200).json({
      message: 'Content proposal generated successfully',
      proposal_id: proposal.id,
      proposal: {
        ...proposal,
        reasoning: parsed.reasoning,
      },
      changes_summary: changesSummary,
      estimated_improvement: {
        score_before: currentScore,
        score_after: estimatedScore,
        keywords_added: changesSummary.keywords_added.length,
        search_volume_added: changesSummary.search_volume_added,
      },
    });

  } catch (error) {
    console.error('Content generation error:', error);
    return res.status(500).json({
      error: 'Content generation failed',
      details: (error as Error).message,
    });
  }
}
