/**
 * Bol.com AI Agent Tools
 *
 * Tool handlers for the Claude agent to query and analyze Bol.com advertising data.
 * These tools are called by the agent in api/chat.ts when tool names start with 'bol_'.
 *
 * CRITICAL: NEVER use analysis.findings for stats - always compute from raw data.
 * FBB CSV exports are unreliable (missing titles/prices). Use time-series tables instead.
 */

import { createAdminClient } from './supabase-admin.js';
import type {
  BolCampaignPerformance,
  BolKeywordPerformance,
  BolProduct,
  BolCompetitorSnapshot,
} from '../../src/types/bol.js';

// ── Type definitions ──────────────────────────────────────────────────────────

interface BolToolContext {
  bolCustomerId?: string;
  conversationId?: string;
}

interface BolAnalyzeCampaignsInput {
  customer_id?: string;
  date_range_days?: number;
  filters?: {
    min_spend?: number;
    max_acos?: number;
    campaign_state?: 'enabled' | 'paused' | 'archived';
  };
}

interface BolAnalyzeProductsInput {
  customer_id: string;
  filters?: {
    missing_titles?: boolean;
    missing_descriptions?: boolean;
    out_of_stock?: boolean;
    eol_only?: boolean;
    fulfillment_method?: 'FBR' | 'FBB';
  };
}

interface BolAnalyzeCompetitorsInput {
  customer_id: string;
  ean?: string;
  focus?: 'buy_box_losses' | 'price_undercut' | 'new_competitors';
}

interface BolGetKeywordRankingsInput {
  customer_id: string;
  ean?: string;
  trend_direction?: 'improving' | 'declining' | 'stable';
}

interface BolCreateProposalInput {
  customer_id: string;
  proposal_type: 'bol_campaign_pause' | 'bol_campaign_budget' | 'bol_keyword_bid' | 'bol_keyword_pause' | 'bol_price_adjust';
  description: string;
  changes: Array<{
    campaign_id?: string;
    keyword?: string;
    ean?: string;
    current_value: number;
    proposed_value: number;
    rationale: string;
  }>;
  estimated_impact: {
    spend_change_pct?: number;
    acos_change_pct?: number;
  };
}

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Deduplicate campaign performance rows to latest per campaign.
 * bol_campaign_performance has time-series data (one row per sync).
 */
function deduplicateCampaigns(rows: BolCampaignPerformance[]): BolCampaignPerformance[] {
  const latest = new Map<string, BolCampaignPerformance>();
  rows.forEach((row) => {
    const existing = latest.get(row.campaign_id);
    if (!existing || new Date(row.synced_at) > new Date(existing.synced_at)) {
      latest.set(row.campaign_id, row);
    }
  });
  return Array.from(latest.values());
}

/**
 * Deduplicate keyword performance rows to latest per keyword.
 */
function deduplicateKeywords(rows: BolKeywordPerformance[]): BolKeywordPerformance[] {
  const latest = new Map<string, BolKeywordPerformance>();
  rows.forEach((row) => {
    const existing = latest.get(row.keyword_id);
    if (!existing || new Date(row.synced_at) > new Date(existing.synced_at)) {
      latest.set(row.keyword_id, row);
    }
  });
  return Array.from(latest.values());
}

/**
 * Compute aggregated campaign metrics from array.
 */
function computeCampaignSummary(campaigns: BolCampaignPerformance[]) {
  const total_spend = campaigns.reduce((sum, c) => sum + (c.spend ?? 0), 0);
  const total_revenue = campaigns.reduce((sum, c) => sum + (c.revenue ?? 0), 0);
  const total_clicks = campaigns.reduce((sum, c) => sum + (c.clicks ?? 0), 0);
  const total_impressions = campaigns.reduce((sum, c) => sum + (c.impressions ?? 0), 0);

  // Weighted average ACOS (by spend)
  const weighted_acos = campaigns.reduce((sum, c) => {
    if (!c.acos || !c.spend) return sum;
    return sum + (c.acos * c.spend);
  }, 0) / (total_spend || 1);

  return {
    total_spend,
    total_revenue,
    avg_acos: weighted_acos,
    avg_roas: total_spend > 0 ? total_revenue / total_spend : 0,
    campaign_count: campaigns.length,
    total_clicks,
    total_impressions,
    avg_ctr: total_impressions > 0 ? (total_clicks / total_impressions) * 100 : 0,
  };
}

/**
 * Compute product quality stats from fetched products array.
 * NEVER use analysis.findings - FBB data is unreliable.
 */
function computeProductStats(products: BolProduct[]) {
  const fbr_products = products.filter(p => p.fulfilmentType === 'FBR');

  // Title quality (only check FBR - FBB titles come from Bol catalog)
  const title_excellent = fbr_products.filter(p => p.title && p.title.length >= 50).length;
  const title_good = fbr_products.filter(p => p.title && p.title.length >= 20 && p.title.length < 50).length;
  const title_poor = fbr_products.filter(p => !p.title || p.title.length < 20).length;

  const missing_prices = products.filter(p => !p.price).length;
  const out_of_stock = products.filter(p => (p.stockAmount ?? 0) === 0).length;
  const avg_price = products.reduce((sum, p) => sum + (p.price ?? 0), 0) / (products.length || 1);

  return {
    total_products: products.length,
    title_quality: {
      excellent: title_excellent,
      good: title_good,
      poor: title_poor,
    },
    missing_prices,
    out_of_stock_count: out_of_stock,
    avg_price: Math.round(avg_price * 100) / 100,
  };
}

/**
 * Generate campaign insights based on metrics.
 */
function generateCampaignInsights(campaigns: BolCampaignPerformance[]): string[] {
  const insights: string[] = [];

  // High ACOS campaigns
  const high_acos = campaigns.filter(c => (c.acos ?? 0) > 30);
  if (high_acos.length > 0) {
    insights.push(`${high_acos.length} campaigns have ACOS > 30% (avg: ${Math.round(high_acos.reduce((s, c) => s + (c.acos ?? 0), 0) / high_acos.length)}%)`);
  }

  // Low ROAS campaigns
  const low_roas = campaigns.filter(c => (c.roas ?? 0) < 2);
  if (low_roas.length > 0) {
    insights.push(`${low_roas.length} campaigns have ROAS < 2.0 - consider pausing or optimizing`);
  }

  // Paused campaigns with good performance
  const paused_good = campaigns.filter(c => c.state === 'PAUSED' && (c.roas ?? 0) > 4);
  if (paused_good.length > 0) {
    insights.push(`${paused_good.length} paused campaigns had ROAS > 4.0 - consider reactivating`);
  }

  // Budget utilization
  const with_budget = campaigns.filter(c => c.budget && c.spend);
  const underspend = with_budget.filter(c => ((c.spend ?? 0) / (c.budget ?? 1)) < 0.7);
  if (underspend.length > 0) {
    insights.push(`${underspend.length} campaigns are spending < 70% of budget - opportunity to scale`);
  }

  return insights;
}

/**
 * Generate product insights based on quality metrics.
 */
function generateProductInsights(products: BolProduct[]): string[] {
  const insights: string[] = [];
  const stats = computeProductStats(products);

  if (stats.title_quality.poor > 0) {
    insights.push(`${stats.title_quality.poor} products have poor titles (< 20 chars) - improve for better SEO`);
  }

  if (stats.out_of_stock_count > 0) {
    insights.push(`${stats.out_of_stock_count} products are out of stock - restock to avoid lost sales`);
  }

  if (stats.missing_prices > 0) {
    insights.push(`${stats.missing_prices} products are missing prices - update pricing to enable sales`);
  }

  const eol_products = products.filter(p => p.eol);
  if (eol_products.length > 0) {
    insights.push(`${eol_products.length} products marked as End of Life - review for clearance or removal`);
  }

  return insights;
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

/**
 * Tool: bol_analyze_campaigns
 * Retrieve and analyze campaign + keyword performance.
 */
async function handleBolAnalyzeCampaigns(input: BolAnalyzeCampaignsInput, _context: BolToolContext) {
  const supabase = createAdminClient();
  const days = input.date_range_days ?? 30;
  const cutoff_date = new Date();
  cutoff_date.setDate(cutoff_date.getDate() - days);

  // Query campaign performance
  let query = supabase
    .from('bol_campaign_performance')
    .select('*')
    .gte('synced_at', cutoff_date.toISOString())
    .order('synced_at', { ascending: false });

  if (input.customer_id) {
    query = query.eq('bol_customer_id', input.customer_id);
  }

  const { data: campaign_rows, error: campaign_error } = await query;
  if (campaign_error) throw new Error(`Failed to fetch campaigns: ${campaign_error.message}`);

  // Deduplicate to latest per campaign
  let campaigns = deduplicateCampaigns(campaign_rows ?? []);

  // Apply filters
  if (input.filters?.min_spend) {
    campaigns = campaigns.filter(c => (c.spend ?? 0) >= input.filters!.min_spend!);
  }
  if (input.filters?.max_acos) {
    campaigns = campaigns.filter(c => (c.acos ?? 0) <= input.filters!.max_acos!);
  }
  if (input.filters?.campaign_state) {
    const state = input.filters.campaign_state.toUpperCase();
    campaigns = campaigns.filter(c => c.state === state);
  }

  // Sort by spend descending, limit to top 20
  campaigns.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const top_campaigns = campaigns.slice(0, 20);

  // Compute summary
  const summary = computeCampaignSummary(campaigns);

  // Generate insights
  const insights = generateCampaignInsights(campaigns);

  return {
    summary,
    campaigns: top_campaigns,
    total_campaign_count: campaigns.length,
    insights,
  };
}

/**
 * Tool: bol_analyze_products
 * Analyze product catalog quality (titles, prices, stock).
 */
async function handleBolAnalyzeProducts(input: BolAnalyzeProductsInput, _context: BolToolContext) {
  const supabase = createAdminClient();

  // Fetch latest inventory snapshot
  const { data: inv_snapshot, error: inv_error } = await supabase
    .from('bol_raw_snapshots')
    .select('raw_data, fetched_at')
    .eq('bol_customer_id', input.customer_id)
    .eq('data_type', 'inventory')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single();

  if (inv_error) throw new Error(`Failed to fetch inventory: ${inv_error.message}`);

  // Fetch latest listings snapshot
  const { data: list_snapshot } = await supabase
    .from('bol_raw_snapshots')
    .select('raw_data')
    .eq('bol_customer_id', input.customer_id)
    .eq('data_type', 'listings')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single();

  // Parse and join on EAN
  const inventory = (inv_snapshot?.raw_data as any[]) ?? [];
  const listings = (list_snapshot?.raw_data as any[]) ?? [];

  const products: BolProduct[] = inventory.map((inv) => {
    const listing = listings.find((l) => l.ean === inv.ean);
    return {
      ean: inv.ean,
      bsku: inv.bsku,
      title: inv.title,
      gradedStock: inv.gradedStock ?? 0,
      regularStock: inv.regularStock ?? 0,
      offerId: listing?.offerId ?? null,
      price: listing?.price ?? null,
      fulfilmentType: listing?.fulfilmentMethod ?? null,
      stockAmount: inv.stock ?? 0,
      onHold: inv.onHoldByRetailer ?? false,
      eol: false, // TODO: join with bol_product_metadata
    };
  });

  // Apply filters
  let filtered = products;
  if (input.filters?.missing_titles) {
    filtered = filtered.filter(p => !p.title && p.fulfilmentType === 'FBR');
  }
  if (input.filters?.out_of_stock) {
    filtered = filtered.filter(p => (p.stockAmount ?? 0) === 0);
  }
  if (input.filters?.fulfillment_method) {
    filtered = filtered.filter(p => p.fulfilmentType === input.filters!.fulfillment_method);
  }

  // Compute stats
  const summary = computeProductStats(products);

  // Generate insights
  const insights = generateProductInsights(products);

  // Flagged products (top 10 issues)
  const flagged_products = products
    .filter(p => !p.title || !p.price || (p.stockAmount ?? 0) === 0)
    .slice(0, 10)
    .map(p => p.ean);

  return {
    summary,
    flagged_products,
    recommendations: insights,
    data_freshness: inv_snapshot?.fetched_at,
  };
}

/**
 * Tool: bol_analyze_competitors
 * Analyze competitor pricing and buy box status.
 */
async function handleBolAnalyzeCompetitors(input: BolAnalyzeCompetitorsInput, _context: BolToolContext) {
  const supabase = createAdminClient();

  let query = supabase
    .from('bol_competitor_snapshots')
    .select('*')
    .eq('bol_customer_id', input.customer_id)
    .order('fetched_at', { ascending: false });

  if (input.ean) {
    query = query.eq('ean', input.ean);
  }

  const { data: snapshots, error } = await query;
  if (error) throw new Error(`Failed to fetch competitors: ${error.message}`);

  // Deduplicate to latest per EAN
  const latest_by_ean = new Map<string, BolCompetitorSnapshot>();
  (snapshots ?? []).forEach((snap) => {
    const existing = latest_by_ean.get(snap.ean);
    if (!existing || new Date(snap.fetched_at) > new Date(existing.fetched_at)) {
      latest_by_ean.set(snap.ean, snap);
    }
  });

  const competitors = Array.from(latest_by_ean.values());

  // Buy box summary
  const buy_box_won = competitors.filter(c => c.buy_box_winner === true).length;
  const buy_box_lost = competitors.filter(c => c.buy_box_winner === false).length;

  // Price alerts (we're more expensive than lowest competitor)
  const price_alerts = competitors
    .filter(c => c.our_price && c.lowest_competing_price && c.our_price > c.lowest_competing_price)
    .map(c => ({
      ean: c.ean,
      our_price: c.our_price!,
      lowest_competitor: c.lowest_competing_price!,
      price_diff: c.our_price! - c.lowest_competing_price!,
    }))
    .sort((a, b) => b.price_diff - a.price_diff)
    .slice(0, 10);

  // Recommendations
  const recommendations: string[] = [];
  if (buy_box_lost > 0) {
    recommendations.push(`Lost buy box on ${buy_box_lost} products - review pricing and fulfillment`);
  }
  if (price_alerts.length > 0) {
    recommendations.push(`${price_alerts.length} products priced above competitors - consider price adjustments`);
  }

  return {
    buy_box_summary: {
      won: buy_box_won,
      lost: buy_box_lost,
      total_products: competitors.length,
    },
    price_alerts,
    recommendations,
  };
}

/**
 * Tool: bol_get_keyword_rankings
 * Retrieve keyword ranking trends (search/browse).
 */
async function handleBolGetKeywordRankings(input: BolGetKeywordRankingsInput, _context: BolToolContext) {
  const supabase = createAdminClient();

  let query = supabase
    .from('bol_keyword_rankings')
    .select('*')
    .eq('bol_customer_id', input.customer_id)
    .order('week_of', { ascending: false });

  if (input.ean) {
    query = query.eq('ean', input.ean);
  }

  const { data: rankings, error } = await query;
  if (error) throw new Error(`Failed to fetch rankings: ${error.message}`);

  // Group by EAN + search_type, compute trend
  const by_key = new Map<string, any[]>();
  (rankings ?? []).forEach((r) => {
    const key = `${r.ean}_${r.search_type}`;
    if (!by_key.has(key)) by_key.set(key, []);
    by_key.get(key)!.push(r);
  });

  const keyword_trends = Array.from(by_key.entries()).map(([key, rows]) => {
    rows.sort((a, b) => new Date(b.week_of).getTime() - new Date(a.week_of).getTime());
    const current = rows[0];
    const previous = rows[1];

    let trend: 'improving' | 'declining' | 'stable' | 'new' = 'stable';
    if (!previous) {
      trend = 'new';
    } else if (current.rank < previous.rank) {
      trend = 'improving';
    } else if (current.rank > previous.rank) {
      trend = 'declining';
    }

    return {
      ean: current.ean,
      search_type: current.search_type,
      current_rank: current.rank,
      previous_rank: previous?.rank ?? null,
      current_impressions: current.impressions,
      trend,
    };
  });

  // Apply filter
  let filtered = keyword_trends;
  if (input.trend_direction) {
    filtered = filtered.filter(k => k.trend === input.trend_direction);
  }

  // Insights
  const insights: string[] = [];
  const improving = keyword_trends.filter(k => k.trend === 'improving').length;
  const declining = keyword_trends.filter(k => k.trend === 'declining').length;

  if (improving > 0) {
    insights.push(`${improving} keywords improving in rank - good SEO momentum`);
  }
  if (declining > 0) {
    insights.push(`${declining} keywords declining in rank - review content optimization`);
  }

  return {
    keywords: filtered.slice(0, 20),
    total_tracked: keyword_trends.length,
    insights,
  };
}

/**
 * Tool: bol_create_proposal
 * Create an optimization proposal for Bol.com.
 */
async function handleBolCreateProposal(input: BolCreateProposalInput, context: BolToolContext) {
  const supabase = createAdminClient();

  // Generate title from proposal type and changes
  const title = `${input.proposal_type.replace('bol_', '').replace(/_/g, ' ')} - ${input.changes.length} change(s)`;

  // Format current/proposed values
  const current_value = input.changes.map(c => `${c.campaign_id ?? c.keyword ?? c.ean}: ${c.current_value}`).join(', ');
  const proposed_value = input.changes.map(c => `${c.campaign_id ?? c.keyword ?? c.ean}: ${c.proposed_value}`).join(', ');

  // Format expected impact
  const impact_parts: string[] = [];
  if (input.estimated_impact.spend_change_pct !== undefined) {
    impact_parts.push(`Spend: ${input.estimated_impact.spend_change_pct > 0 ? '+' : ''}${input.estimated_impact.spend_change_pct}%`);
  }
  if (input.estimated_impact.acos_change_pct !== undefined) {
    impact_parts.push(`ACOS: ${input.estimated_impact.acos_change_pct > 0 ? '+' : ''}${input.estimated_impact.acos_change_pct}%`);
  }
  const expected_impact = impact_parts.join(', ');

  const { data, error } = await supabase
    .from('optimization_proposals')
    .insert({
      platform: 'bol',
      bol_customer_id: input.customer_id,
      client_id: null,
      market_id: null,
      conversation_id: context.conversationId ?? null,
      title,
      description: input.description,
      proposal_type: input.proposal_type,
      current_value,
      proposed_value,
      expected_impact,
      status: 'pending',
      amazon_api_payload: { changes: input.changes }, // Reuse JSONB field for Bol payload
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create proposal: ${error.message}`);

  return {
    success: true,
    proposal_id: data.id,
    message: `Proposal created successfully. It's now pending approval in the dashboard.`,
  };
}

// ── Main router ───────────────────────────────────────────────────────────────

/**
 * Route Bol tool calls to appropriate handlers.
 * Called by api/chat.ts when tool name starts with 'bol_'.
 */
export async function handleBolTool(
  toolName: string,
  input: unknown,
  context: BolToolContext
): Promise<any> {
  switch (toolName) {
    case 'bol_analyze_campaigns':
      return handleBolAnalyzeCampaigns(input as BolAnalyzeCampaignsInput, context);

    case 'bol_analyze_products':
      return handleBolAnalyzeProducts(input as BolAnalyzeProductsInput, context);

    case 'bol_analyze_competitors':
      return handleBolAnalyzeCompetitors(input as BolAnalyzeCompetitorsInput, context);

    case 'bol_get_keyword_rankings':
      return handleBolGetKeywordRankings(input as BolGetKeywordRankingsInput, context);

    case 'bol_create_proposal':
      return handleBolCreateProposal(input as BolCreateProposalInput, context);

    default:
      throw new Error(`Unknown Bol tool: ${toolName}`);
  }
}
