/**
 * Shared helper functions for Bol.com content generation
 * Used by both the old API endpoint and new skill-based system
 */
import { createAdminClient } from './supabase-admin.js';
import type { ContentGenerationContext } from './bol-content-prompts.js';
import type { BolContentChangesSummary, BolContentProposal } from '../../src/types/bol.js';

/**
 * Fetch all data needed for content generation
 * Extracted from /api/bol-content-generate.ts lines 32-125
 */
export async function fetchContentGenerationContext(
  customerId: string,
  ean: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<ContentGenerationContext | { error: string }> {
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
      return { error: 'Product not found or no catalog data available' };
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
      return {
        error: 'No target keywords found for this product. Run keyword enrichment first.'
      };
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

    // Return structured context
    return {
      product: {
        ean,
        title: catalogAttrs.Title || null,
        description: catalogAttrs.Description || null,
        category: categoryName,
        price: null,
        catalogAttributes: catalogAttrs,
      },
      keywords: keywords as any[],
      categoryRequirements: categoryReqs as any,
      clientBrief: briefData?.brief_text || null,
      competitor: competitorData || null,
      currentCompleteness: completeness,
    };

  } catch (err: any) {
    console.error('[fetchContentGenerationContext] Error:', err);
    return { error: `Failed to fetch context: ${err.message}` };
  }
}

/**
 * Save content proposal to database
 * Extracted from /api/bol-content-generate.ts lines 168-191
 */
export async function saveContentProposal(
  customerId: string,
  ean: string,
  context: ContentGenerationContext,
  parsed: { title: string; description: string; description_parts: any; reasoning?: string },
  changesSummary: BolContentChangesSummary,
  triggerReason: 'manual' | 'quality_score' | 'keyword_trend',
  supabase: ReturnType<typeof createAdminClient>,
  promptVersionId?: string | null
): Promise<BolContentProposal> {
  // Calculate score improvement estimate (rough heuristic)
  const currentScore = context.currentCompleteness?.overall_completeness_score || 0;
  const scoreImprovement = Math.min(20, changesSummary.keywords_added.length * 5); // +5% per keyword, max +20%
  const estimatedScore = Math.min(100, currentScore + scoreImprovement);

  // Insert proposal
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
      prompt_version_id: promptVersionId || null,
    })
    .select()
    .single();

  if (insertErr || !proposal) {
    console.error('Failed to save proposal:', insertErr);
    throw new Error(`Failed to save proposal: ${insertErr?.message || 'Unknown error'}`);
  }

  return proposal as BolContentProposal;
}
