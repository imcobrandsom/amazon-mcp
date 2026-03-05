import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';
import { generateBolContent } from './_lib/bol-content.js';
import type { BolContentTriggerReason } from '../src/types/bol';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customerId, eans, trigger_reason } = req.body as {
    customerId: string;
    eans: string[];
    trigger_reason?: BolContentTriggerReason;
  };

  if (!customerId || !Array.isArray(eans) || eans.length === 0) {
    return res.status(400).json({ error: 'customerId and eans[] required' });
  }

  const supabase = createAdminClient();
  const triggerReason = trigger_reason ?? 'manual';
  const generated: string[] = [];
  const skipped: Array<{ ean: string; reason: string }> = [];

  try {
    // Fetch client brief
    const { data: briefData } = await supabase
      .from('bol_client_brief')
      .select('brief_text')
      .eq('bol_customer_id', customerId)
      .maybeSingle();

    const clientBrief = briefData?.brief_text ?? '';

    for (const ean of eans) {
      try {
        // Check for recent non-rejected proposal (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: existingProposal } = await supabase
          .from('bol_content_proposals')
          .select('id')
          .eq('bol_customer_id', customerId)
          .eq('ean', ean)
          .neq('status', 'rejected')
          .gte('generated_at', thirtyDaysAgo.toISOString())
          .maybeSingle();

        if (existingProposal) {
          skipped.push({ ean, reason: 'recent_proposal_exists' });
          continue;
        }

        // Fetch basis content
        const { data: basisContent } = await supabase
          .from('bol_content_base')
          .select('*')
          .eq('bol_customer_id', customerId)
          .eq('ean', ean)
          .maybeSingle();

        if (!basisContent) {
          skipped.push({ ean, reason: 'no_basis_content' });
          continue;
        }

        // Fetch current content from latest inventory snapshot
        const { data: inventorySnap } = await supabase
          .from('bol_raw_snapshots')
          .select('data')
          .eq('bol_customer_id', customerId)
          .eq('data_type', 'inventory')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let currentTitle: string | null = null;
        let currentDescription: string | null = null;

        if (inventorySnap?.data && Array.isArray(inventorySnap.data)) {
          const product = inventorySnap.data.find((p: any) => p.ean === ean);
          if (product) {
            currentTitle = product.title ?? null;
            currentDescription = product.description ?? null;
          }
        }

        // Fetch content score from latest analysis
        const { data: analysisData } = await supabase
          .from('bol_analyses')
          .select('score')
          .eq('bol_customer_id', customerId)
          .eq('category', 'content')
          .order('analyzed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const scoreBefore = analysisData?.score ?? null;

        // Fetch top keywords from search volume data (latest week, top 15 by volume)
        const { data: keywordData } = await supabase
          .from('bol_keyword_search_volume')
          .select('keyword, search_volume')
          .eq('bol_customer_id', customerId)
          .order('week_of', { ascending: false })
          .order('search_volume', { ascending: false })
          .limit(15);

        const topKeywords = (keywordData ?? []).map(k => k.keyword);

        // Fetch trending keywords (volume increased in last 2 weeks)
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const { data: trendingData } = await supabase
          .from('bol_keyword_search_volume')
          .select('keyword')
          .eq('bol_customer_id', customerId)
          .gte('week_of', twoWeeksAgo.toISOString())
          .order('search_volume', { ascending: false })
          .limit(10);

        const trendingKeywords = (trendingData ?? []).map(k => k.keyword);

        // Fetch category for this product
        const { data: categoryData } = await supabase
          .from('bol_product_category')
          .select('category_slug')
          .eq('bol_customer_id', customerId)
          .eq('ean', ean)
          .maybeSingle();

        const categorySlug = categoryData?.category_slug;

        // Fetch competitor titles and USPs from same category
        let competitorTitles: string[] = [];
        let competitorUsps: string[] = [];

        if (categorySlug) {
          const { data: competitorCatalog } = await supabase
            .from('bol_competitor_catalog')
            .select('title')
            .eq('bol_customer_id', customerId)
            .eq('category_slug', categorySlug)
            .not('title', 'is', null)
            .limit(10);

          competitorTitles = (competitorCatalog ?? [])
            .map(c => c.title)
            .filter((t): t is string => !!t);

          const { data: competitorAnalysis } = await supabase
            .from('bol_competitor_content_analysis')
            .select('extracted_usps')
            .eq('bol_customer_id', customerId)
            .eq('category_slug', categorySlug)
            .not('extracted_usps', 'is', null)
            .limit(10);

          const allUsps = (competitorAnalysis ?? [])
            .flatMap(c => c.extracted_usps ?? []);
          competitorUsps = [...new Set(allUsps)].slice(0, 15);
        }

        // Generate content
        const result = await generateBolContent({
          ean,
          currentTitle,
          currentDescription,
          basisTitle: basisContent.title,
          basisDescription: basisContent.description,
          clientBrief,
          topKeywords,
          trendingKeywords,
          competitorTitles,
          competitorUsps,
        });

        // Insert proposal
        const { error: insertError } = await supabase
          .from('bol_content_proposals')
          .insert({
            bol_customer_id: customerId,
            ean,
            status: 'pending',
            trigger_reason: triggerReason,
            current_title: currentTitle,
            current_description: currentDescription,
            proposed_title: result.proposed_title,
            proposed_description: result.proposed_description,
            proposed_description_parts: result.proposed_description_parts,
            score_before: scoreBefore,
            score_after_estimate: result.score_after_estimate,
            changes_summary: result.changes_summary,
          });

        if (insertError) {
          skipped.push({ ean, reason: `insert_failed: ${insertError.message}` });
          continue;
        }

        generated.push(ean);

        // If triggered by keyword trend, mark related trends as acted upon
        if (triggerReason === 'keyword_trend') {
          await supabase
            .from('bol_content_trends')
            .update({
              is_acted_upon: true,
              acted_upon_at: new Date().toISOString(),
            })
            .eq('bol_customer_id', customerId)
            .contains('affected_eans', [ean])
            .eq('is_acted_upon', false);
        }
      } catch (error: any) {
        console.error(`Generation failed for EAN ${ean}:`, error);
        skipped.push({ ean, reason: `error: ${error.message}` });
      }
    }

    return res.status(200).json({ generated, skipped });
  } catch (error: any) {
    console.error('Content generation error:', error);
    return res.status(500).json({ error: error.message ?? 'Generation failed' });
  }
}
