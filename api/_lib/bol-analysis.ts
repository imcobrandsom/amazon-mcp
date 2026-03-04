/**
 * Bol.com Analysis Engine
 * Scores listings, inventory, orders, advertising, returns, and performance
 * against best-practice thresholds.
 */

export interface AnalysisResult {
  score: number;                  // 0–100
  findings: Record<string, unknown>;
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; title: string; action: string; impact: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Content analysis (from parsed CSV offers rows) ────────────────────────────

export interface OfferInsightsMap {
  [offerId: string]: {
    buyBoxPct:   number | null;
    visits:      number;
    impressions: number;
    clicks:      number;
    conversions: number;
  };
}

export function analyzeContent(
  offers: Record<string, string>[],
  insightsMap?: OfferInsightsMap
): AnalysisResult {
  if (!offers.length) {
    return { score: 0, findings: { message: 'No offers found', offers_count: 0 }, recommendations: [] };
  }

  const titleScores: number[] = [];
  const descriptionScores: number[] = [];
  const priceSet: boolean[] = [];
  const forbiddenKeywords = [
    'Milieuvriendelijk','Eco','Duurzaam','Biologisch afbreekbaar','CO2-neutraal','Klimaatneutraal',
  ];

  // Description quality tracking
  let descriptionsWithIntro = 0;
  let descriptionsWithUSPs = 0;
  let descriptionsWithBullets = 0;
  let descriptionsWithSpecs = 0;
  let descriptionsComplete = 0;
  let descriptionsPartial = 0;
  let descriptionsMissing = 0;

  for (const offer of offers) {
    // ── Title Analysis ────────────────────────────────────────────────────────────
    // bol.com offers export CSV does NOT include product titles for catalog products.
    // 'unknown-product-title' only applies to EANs not yet in the bol.com catalog.
    const title = offer['title'] ?? offer['Title'] ?? offer['unknown-product-title'] ?? '';
    const len = title.length;

    // Title scoring: 150–175 chars = 100, exists but wrong length = 65, missing = 0
    if (len >= 150 && len <= 175) titleScores.push(100);
    else if (len > 0 && len < 150) titleScores.push(65);
    else if (len > 175) titleScores.push(80); // too long but fixable
    else titleScores.push(0);

    // ── Description Analysis ──────────────────────────────────────────────────────
    const description = offer['description'] ?? offer['Description'] ?? '';
    const descLen = description.length;

    if (descLen === 0) {
      descriptionScores.push(0);
      descriptionsMissing++;
    } else {
      let descScore = 0;
      let componentsFound = 0;

      // Check for intro (first 300 chars should contain meaningful content)
      const intro = description.substring(0, 300);
      const hasIntro = intro.length >= 100 && /[a-zA-Z]{50,}/.test(intro);
      if (hasIntro) {
        descScore += 25;
        componentsFound++;
        descriptionsWithIntro++;
      }

      // Check for USPs (look for bullet points or numbered list items)
      // Pattern: lines starting with • - * or numbers, at least 3 items
      const uspPatterns = [
        /[•\-\*]\s*.{20,}/g,           // Bullet points
        /\d+\.\s*.{20,}/g,             // Numbered lists
        /<li[^>]*>.{20,}<\/li>/gi,     // HTML list items
        /\n\s*[-•]\s*.{20,}/g          // Line-break bullets
      ];
      let uspCount = 0;
      for (const pattern of uspPatterns) {
        const matches = description.match(pattern);
        if (matches && matches.length > uspCount) {
          uspCount = matches.length;
        }
      }
      const hasUSPs = uspCount >= 3;
      if (hasUSPs) {
        descScore += 25;
        componentsFound++;
        descriptionsWithUSPs++;
      }

      // Check for bullet points / feature list (5+ items)
      const hasBullets = uspCount >= 5;
      if (hasBullets) {
        descScore += 25;
        componentsFound++;
        descriptionsWithBullets++;
      }

      // Check for specifications (technical details, measurements, materials)
      // Look for common spec indicators
      const specKeywords = [
        /materiaal:?\s*\w+/i,
        /afmeting:?\s*[\d\s,x×]+/i,
        /gewicht:?\s*[\d\s,]+/i,
        /kleur:?\s*\w+/i,
        /maat:?\s*[\w\d]+/i,
        /specificaties?/i,
        /technische?\s+gegevens/i,
        /eigenschappen/i,
        /<table/i,                     // Spec tables
      ];
      let hasSpecs = false;
      for (const pattern of specKeywords) {
        if (pattern.test(description)) {
          hasSpecs = true;
          break;
        }
      }
      if (hasSpecs) {
        descScore += 25;
        componentsFound++;
        descriptionsWithSpecs++;
      }

      descriptionScores.push(descScore);

      // Track completeness
      if (componentsFound >= 3) {
        descriptionsComplete++;
      } else if (componentsFound > 0) {
        descriptionsPartial++;
      }
    }

    // ── Price Analysis ────────────────────────────────────────────────────────────
    // bol.com v10 offers export: price column is 'price'; fall back to 'unit-price'
    const priceRaw = offer['price'] ?? offer['unit-price'] ?? offer['Price'] ?? '';
    // Handle Dutch decimal format (comma) and strip any currency symbol
    const priceNorm = priceRaw.replace(/[€$£\s]/g, '').replace(',', '.');
    const price = parseFloat(priceNorm);
    priceSet.push(!isNaN(price) && price > 0);
  }

  // ── Scoring ───────────────────────────────────────────────────────────────────
  // When ALL titles are missing it means the offers export doesn't include title data
  // (normal for bol.com LVB/FBB sellers — catalog titles are managed by bol.com).
  // In that case skip title scoring to avoid artificially low scores.
  const missingTitles   = titleScores.filter(s => s === 0).length;
  const shortTitles     = titleScores.filter(s => s === 65).length;
  const allTitlesMissing = missingTitles === offers.length;

  // Same logic for descriptions: when ALL are missing, the export doesn't include them
  const allDescriptionsMissing = descriptionsMissing === offers.length;

  const avgTitleScore = allTitlesMissing ? 50 : avg(titleScores);
  const avgDescScore  = allDescriptionsMissing ? 50 : avg(descriptionScores);
  const priceSetPct   = priceSet.filter(Boolean).length / priceSet.length;

  // Weighted scoring: title 40%, description 40%, price 20%
  const score = Math.round(
    avgTitleScore * 0.4 +
    avgDescScore * 0.4 +
    priceSetPct * 100 * 0.2
  );

  const recs: AnalysisResult['recommendations'] = [];

  // ── Title Recommendations ─────────────────────────────────────────────────────
  // Only raise title recommendations when some (not all) titles are present but incomplete
  if (!allTitlesMissing && missingTitles > 0)
    recs.push({ priority: 'high', title: 'Missing product titles',
      action: `${missingTitles} offer(s) have no title. Add a Dutch title of 150–175 chars starting with the brand name.`,
      impact: '15–25% CTR improvement' });

  if (!allTitlesMissing && shortTitles > 0)
    recs.push({ priority: 'high', title: 'Short product titles',
      action: `${shortTitles} offer(s) have titles under 150 chars. Expand to 150–175 chars with relevant keywords.`,
      impact: '10–20% CTR improvement' });

  // ── Description Recommendations ───────────────────────────────────────────────
  // Only raise description recommendations when some (not all) descriptions are present but incomplete
  if (!allDescriptionsMissing && descriptionsMissing > 0)
    recs.push({ priority: 'high', title: 'Missing product descriptions',
      action: `${descriptionsMissing} offer(s) have no description. Add a complete description with intro (300 chars), 3 USPs, 5 bullet points, and specifications.`,
      impact: '25–40% conversion improvement' });

  if (!allDescriptionsMissing && descriptionsPartial > 0 && descriptionsMissing === 0)
    recs.push({ priority: 'high', title: 'Incomplete product descriptions',
      action: `${descriptionsPartial} offer(s) have incomplete descriptions. Best practice: intro text (first 300 chars with keywords), 3 USPs, 5+ bullet points, technical specifications.`,
      impact: '15–30% conversion improvement' });

  if (!allDescriptionsMissing && descriptionsWithIntro < offers.length && descriptionsMissing < offers.length)
    recs.push({ priority: 'medium', title: 'Add intro text to descriptions',
      action: `${offers.length - descriptionsWithIntro - descriptionsMissing} description(s) lack an intro paragraph. First 300 characters are indexed by Google — include main keywords here.`,
      impact: '10–15% SEO improvement' });

  if (!allDescriptionsMissing && descriptionsWithUSPs < offers.length / 2)
    recs.push({ priority: 'medium', title: 'Add USPs to descriptions',
      action: `Only ${descriptionsWithUSPs} product(s) have clear USPs (Unique Selling Points). Add 3 USPs per product highlighting key benefits.`,
      impact: '15–25% conversion lift' });

  if (!allDescriptionsMissing && descriptionsWithBullets < offers.length / 2)
    recs.push({ priority: 'medium', title: 'Add bullet points to descriptions',
      action: `Only ${descriptionsWithBullets} product(s) have bullet point features. Add 5+ concise bullets summarizing main characteristics.`,
      impact: '10–20% readability improvement' });

  // ── Price Recommendations ─────────────────────────────────────────────────────
  if (priceSetPct < 1)
    recs.push({ priority: 'medium', title: 'Offers missing price',
      action: `${priceSet.filter(v => !v).length} offer(s) have no price set. This disables the Buy Box.`,
      impact: 'Direct sales recovery' });

  // ── Aggregate offer insights if provided ───────────────────────────────────
  let totalVisits      = 0;
  let totalImpressions = 0;
  let totalClicks      = 0;
  let totalConversions = 0;
  let buyBoxPcts: number[] = [];
  const perOfferInsights: Array<{
    offerId: string;
    title: string;
    visits: number;
    impressions: number;
    buyBoxPct: number | null;
  }> = [];

  if (insightsMap) {
    for (const offer of offers) {
      // bol.com v10 offers export CSV uses 'offer-id' (hyphen); accept all variants
      const offerId = offer['offer-id'] ?? offer['Offer Id'] ?? offer['offer_id'] ?? '';
      const ins = insightsMap[offerId];
      if (ins) {
        totalVisits      += ins.visits;
        totalImpressions += ins.impressions;
        totalClicks      += ins.clicks;
        totalConversions += ins.conversions;
        if (ins.buyBoxPct !== null) buyBoxPcts.push(ins.buyBoxPct);
        perOfferInsights.push({
          offerId,
          title: (offer['title'] ?? offer['Title'] ?? '').slice(0, 80),
          visits: ins.visits,
          impressions: ins.impressions,
          buyBoxPct: ins.buyBoxPct,
        });
      }
    }
    // Sort by visits desc for display
    perOfferInsights.sort((a, b) => b.visits - a.visits);

    const avgBuyBoxPct = buyBoxPcts.length ? Math.round(avg(buyBoxPcts)) : null;
    if (avgBuyBoxPct !== null && avgBuyBoxPct < 50) {
      recs.push({ priority: 'medium', title: 'Low Buy Box win rate',
        action: `Your average Buy Box win rate is ${avgBuyBoxPct}%. Optimise pricing and fulfilment to win more Buy Boxes.`,
        impact: '20–40% revenue increase' });
    }
  }

  return {
    score,
    findings: {
      offers_count:             offers.length,
      // Title metrics
      avg_title_score:          Math.round(avgTitleScore),
      titles_in_range:          titleScores.filter(s => s === 100).length,
      titles_short:             shortTitles,
      titles_missing:           missingTitles,
      titles_not_in_export:     allTitlesMissing,
      // Description metrics (new)
      avg_description_score:    Math.round(avgDescScore),
      descriptions_complete:    descriptionsComplete,
      descriptions_partial:     descriptionsPartial,
      descriptions_missing:     descriptionsMissing,
      descriptions_not_in_export: allDescriptionsMissing,  // Signal that description data unavailable
      descriptions_with_intro:  descriptionsWithIntro,
      descriptions_with_usps:   descriptionsWithUSPs,
      descriptions_with_bullets: descriptionsWithBullets,
      descriptions_with_specs:  descriptionsWithSpecs,
      // Price metrics
      price_set_pct:            Math.round(priceSetPct * 100),
      forbidden_keyword_warning: forbiddenKeywords.some(kw =>
        offers.some(o => (o['title'] ?? o['unknown-product-title'] ?? '').toLowerCase().includes(kw.toLowerCase()))
      ),
      // Offer insights aggregates (only set when insightsMap provided)
      ...(insightsMap ? {
        total_visits:      totalVisits,
        total_impressions: totalImpressions,
        total_clicks:      totalClicks,
        total_conversions: totalConversions,
        avg_buy_box_pct:   buyBoxPcts.length ? Math.round(avg(buyBoxPcts)) : null,
        per_offer_insights: perOfferInsights,
      } : {}),
    },
    recommendations: recs,
  };
}

// ── Inventory analysis ────────────────────────────────────────────────────────

interface InventoryItem {
  stock?: { actualStock?: number };
  title?: string;
  offer?: { offerId?: string; fulfilmentMethod?: string };
}

export function analyzeInventory(inventory: unknown[]): AnalysisResult {
  if (!inventory.length) {
    return { score: 50, findings: { message: 'No inventory data returned', items_count: 0 }, recommendations: [] };
  }

  const items = inventory as InventoryItem[];

  const fbbItems = items.filter(i => i.offer?.fulfilmentMethod === 'FBB');
  const fbrItems = items.filter(i => i.offer?.fulfilmentMethod === 'FBR');
  const unknownItems = items.filter(i => !i.offer?.fulfilmentMethod);
  const allZeroStock = items.every(i => (i.stock?.actualStock ?? 0) === 0);

  const isFbrSeller =
    (fbrItems.length > 0 && fbbItems.length === 0) ||
    (unknownItems.length === items.length && allZeroStock);

  if (isFbrSeller) {
    return {
      score: 75,
      findings: {
        items_count:      items.length,
        fulfilment_model: 'FBR',
        message:          'FBR seller — stock managed in own warehouse, not tracked by bol.com',
        fbr_items:        items.length,
        fbb_items:        0,
      },
      recommendations: [
        {
          priority: 'medium',
          title:  'Consider FBB for best-sellers',
          action: 'Migrate high-volume products to Fulfilled by Bol (FBB) for faster delivery and Buy Box advantage.',
          impact: '15–25% sales lift for FBB products',
        },
      ],
    };
  }

  const scoredItems  = fbbItems.length > 0 ? fbbItems : items;
  const stockLevels  = scoredItems.map(i => i.stock?.actualStock ?? 0);
  const outOfStock   = stockLevels.filter(s => s === 0).length;
  const criticalLow  = stockLevels.filter(s => s > 0 && s <= 7).length;
  const lowStock     = stockLevels.filter(s => s > 7 && s <= 15).length;
  const totalScored  = scoredItems.length;

  const healthyPct   = totalScored > 0 ? (totalScored - outOfStock - criticalLow) / totalScored : 1;
  const score        = Math.round(healthyPct * 100);

  const recs: AnalysisResult['recommendations'] = [];

  if (outOfStock > 0)
    recs.push({ priority: 'high', title: `${outOfStock} FBB product(s) out of stock`,
      action: 'Replenish FBB stock immediately. Out-of-stock FBB products lose the Buy Box.',
      impact: 'Prevent lost sales from stockouts' });

  if (criticalLow > 0)
    recs.push({ priority: 'high', title: `${criticalLow} FBB product(s) critically low (<7 days)`,
      action: 'Place replenishment order now before stockout.',
      impact: 'Prevent imminent revenue loss' });

  if (lowStock > 0)
    recs.push({ priority: 'medium', title: `${lowStock} FBB product(s) low stock (7–15 days)`,
      action: 'Plan replenishment within the week.',
      impact: 'Maintain stable inventory coverage' });

  const overstock = stockLevels.filter(s => s > 180).length;
  if (overstock > 0)
    recs.push({ priority: 'low', title: `${overstock} FBB product(s) overstocked (>180 days)`,
      action: 'Consider promotional pricing to improve cash flow and reduce storage costs.',
      impact: 'Improved capital efficiency' });

  if (fbrItems.length > 0)
    recs.push({ priority: 'medium', title: 'Consider FBB for best-sellers',
      action: `You have ${fbrItems.length} FBR product(s). Migrating top sellers to FBB improves delivery speed and Buy Box win rate.`,
      impact: '15–25% sales lift for converted products' });

  return {
    score,
    findings: {
      items_count:       items.length,
      fulfilment_model:  fbrItems.length > 0 && fbbItems.length > 0 ? 'MIXED' : 'FBB',
      fbr_items:         fbrItems.length,
      fbb_items:         fbbItems.length,
      fbb_out_of_stock:  outOfStock,
      fbb_critical_low:  criticalLow,
      fbb_low_stock:     lowStock,
      fbb_healthy:       totalScored - outOfStock - criticalLow - lowStock,
      avg_fbb_stock:     Math.round(avg(stockLevels)),
    },
    recommendations: recs,
  };
}

// ── Orders analysis ───────────────────────────────────────────────────────────

interface Order {
  orderItems?: Array<{ fulfilment?: { method?: string }; cancellation?: { reasonCode?: string } }>;
}

export function analyzeOrders(orders: unknown[]): AnalysisResult {
  if (!orders.length) {
    return { score: 75, findings: { message: 'No orders in the selected period', orders_count: 0 }, recommendations: [] };
  }

  const typed      = orders as Order[];
  const total      = typed.length;
  let cancellations = 0;
  let fbrCount     = 0;
  let fbbCount     = 0;

  for (const order of typed) {
    for (const item of order.orderItems ?? []) {
      if (item.cancellation?.reasonCode) cancellations++;
      if (item.fulfilment?.method === 'FBB') fbbCount++;
      else fbrCount++;
    }
  }

  const cancelRate = total > 0 ? cancellations / total : 0;
  const fbbRate    = (fbrCount + fbbCount) > 0 ? fbbCount / (fbrCount + fbbCount) : 0;

  let score = 100;
  if (cancelRate > 0.05) score -= 30;
  else if (cancelRate > 0.02) score -= 15;
  if (fbbRate === 0 && total > 10) score -= 10;

  const recs: AnalysisResult['recommendations'] = [];

  if (cancelRate > 0.02)
    recs.push({ priority: cancelRate > 0.05 ? 'high' : 'medium',
      title: `High cancellation rate (${Math.round(cancelRate * 100)}%)`,
      action: 'Review cancellation reasons. Common causes: stock issues, fulfilment delays, pricing errors.',
      impact: '15–25% reduction in cancellations' });

  if (fbbRate < 0.5 && total > 10)
    recs.push({ priority: 'medium', title: 'Low FBB usage',
      action: 'Migrate best-selling products to Fulfilled by Bol (FBB) for 30% faster delivery and Buy Box advantage.',
      impact: '15–25% sales lift for FBB products' });

  return {
    score: Math.max(0, score),
    findings: {
      orders_count:      total,
      cancellations,
      cancel_rate_pct:   Math.round(cancelRate * 100),
      fbr_orders:        fbrCount,
      fbb_orders:        fbbCount,
      fbb_rate_pct:      Math.round(fbbRate * 100),
    },
    recommendations: recs,
  };
}

// ── Advertising analysis ──────────────────────────────────────────────────────

interface AdsCampaign {
  campaignId?: string;
  name?: string;
  state?: string;   // bol.com Advertiser API v11: 'ENABLED' | 'PAUSED' | 'ARCHIVED'
  status?: string;  // fallback for older response shapes
  // v11 wraps dailyBudget in an object { amount, currency }
  dailyBudget?: number | { amount?: number; currency?: string };
  budget?: { dailyBudget?: number };
}

interface AdsPerformanceRow {
  campaignId?: string;
  impressions?: number;
  clicks?: number;
  // bol.com Advertiser API v11 field names:
  cost?: number;           // ad spend
  sales14d?: number;       // attributed revenue (14-day window)
  conversions14d?: number; // attributed conversions (14-day window)
  // Legacy / fallback field names:
  spend?: number;
  revenue?: number;
  conversions?: number;
  orders?: number;
}

export function analyzeAdvertising(
  campaigns: unknown[],
  _adGroups: unknown[],
  performance: unknown[]
): AnalysisResult {
  if (!campaigns.length && !performance.length) {
    return {
      score: 0,
      findings: { message: 'No advertising data', campaigns_count: 0 },
      recommendations: [],
    };
  }

  const cMap = new Map<string, AdsCampaign>();
  for (const c of campaigns as AdsCampaign[]) {
    if (c.campaignId) cMap.set(c.campaignId, c);
  }

  const perf = performance as AdsPerformanceRow[];
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalConversions = 0, totalRevenue = 0;

  const perCampaign: Array<{
    id: string; name: string; spend: number; impressions: number;
    clicks: number; ctr: number; conversions: number; roas: number; budget_utilisation_pct: number;
  }> = [];

  for (const row of perf) {
    // bol.com Advertiser API v11 uses cost/sales14d/conversions14d; fall back to legacy names
    const spend       = row.cost        ?? row.spend   ?? 0;
    const impressions = row.impressions ?? 0;
    const clicks      = row.clicks      ?? 0;
    const conversions = row.conversions14d ?? row.conversions ?? row.orders ?? 0;
    const revenue     = row.sales14d    ?? row.revenue ?? 0;

    totalSpend       += spend;
    totalImpressions += impressions;
    totalClicks      += clicks;
    totalConversions += conversions;
    totalRevenue     += revenue;

    const campaign    = cMap.get(row.campaignId ?? '');
    // v11 dailyBudget may be an object { amount, currency }; fall back to flat number
    const rawBudget   = campaign?.dailyBudget;
    const dailyBudget = typeof rawBudget === 'object' && rawBudget !== null
      ? ((rawBudget as { amount?: number }).amount ?? 0)
      : ((rawBudget as number | undefined) ?? campaign?.budget?.dailyBudget ?? 0);
    // Estimate budget utilisation: spend vs 30-day budget
    const budget_utilisation_pct = dailyBudget > 0 ? Math.min(100, Math.round((spend / (dailyBudget * 30)) * 100)) : 0;

    perCampaign.push({
      id:            row.campaignId ?? '',
      name:          campaign?.name ?? `Campaign ${row.campaignId}`,
      spend:         Math.round(spend * 100) / 100,
      impressions,
      clicks,
      ctr:           impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      conversions,
      roas:          spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
      budget_utilisation_pct,
    });
  }

  perCampaign.sort((a, b) => b.spend - a.spend);

  const overallCtr  = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0;
  const overallRoas = totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0;
  // v11 uses state === 'ENABLED'; fall back to status === 'ACTIVE' for older shapes
  const activeCampaigns = (campaigns as AdsCampaign[])
    .filter(c => (c.state ?? c.status) === 'ENABLED').length;

  // Scoring
  let score = 70;
  if (overallRoas >= 5) score += 20;
  else if (overallRoas >= 3) score += 10;
  else if (overallRoas < 1 && totalSpend > 0) score -= 20;

  const cappedCampaigns = perCampaign.filter(c => c.budget_utilisation_pct > 95);
  if (cappedCampaigns.length > 0) score -= 5;

  const recs: AnalysisResult['recommendations'] = [];

  if (overallRoas < 3 && totalSpend > 0)
    recs.push({ priority: 'high', title: `Low overall ROAS (${overallRoas}×)`,
      action: 'Review keyword bids and match types. Pause high-spend / low-conversion keywords.',
      impact: 'Improve ad profitability by 30–50%' });

  if (cappedCampaigns.length > 0)
    recs.push({ priority: 'medium',
      title: `${cappedCampaigns.length} campaign(s) hitting budget cap`,
      action: `Campaigns nearing 100% budget utilisation may miss traffic. Consider increasing daily budgets: ${cappedCampaigns.slice(0, 3).map(c => c.name).join(', ')}.`,
      impact: '10–20% more impressions and clicks' });

  if (overallCtr < 0.3 && totalImpressions > 10000)
    recs.push({ priority: 'medium', title: `Low click-through rate (${overallCtr}%)`,
      action: 'Test different ad creatives and bid on more specific, high-intent keywords.',
      impact: 'Higher CTR → lower cost per click' });

  if (totalClicks > 100 && totalConversions === 0)
    recs.push({ priority: 'high', title: 'No conversions despite clicks',
      action: 'Check that advertised products are in stock, have competitive prices, and winning the Buy Box.',
      impact: 'Direct revenue impact' });

  return {
    score: Math.max(0, Math.min(100, score)),
    findings: {
      campaigns_count:    campaigns.length,
      active_campaigns:   activeCampaigns,
      total_spend:        Math.round(totalSpend * 100) / 100,
      total_impressions:  totalImpressions,
      total_clicks:       totalClicks,
      total_conversions:  totalConversions,
      conversion_rate_pct: totalClicks > 0
        ? Math.round((totalConversions / totalClicks) * 10000) / 100
        : 0,
      ctr_pct:            overallCtr,
      roas:               overallRoas,
      per_campaign:       perCampaign,
    },
    recommendations: recs,
  };
}

// ── Returns analysis ──────────────────────────────────────────────────────────

interface ReturnItem {
  returnReason?: { mainReason?: string; detailedReason?: string };
  quantity?: number;
  handlingResult?: string;
}

export function analyzeReturns(openReturns: unknown[], handledReturns: unknown[]): AnalysisResult {
  const open    = openReturns    as ReturnItem[];
  const handled = handledReturns as ReturnItem[];
  const totalOpen    = open.length;
  const totalHandled = handled.length;

  // Aggregate return reasons
  const reasonCounts = new Map<string, number>();
  for (const r of [...open, ...handled]) {
    const reason = r.returnReason?.mainReason ?? 'Unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + (r.quantity ?? 1));
  }

  const topReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // Scoring
  let score = 90;
  if (totalOpen > 50) score -= 20;
  else if (totalOpen > 20) score -= 10;

  const recs: AnalysisResult['recommendations'] = [];

  if (totalOpen > 20)
    recs.push({ priority: totalOpen > 50 ? 'high' : 'medium',
      title: `${totalOpen} unhandled return(s)`,
      action: 'Process open returns promptly. bol.com monitors return handling speed.',
      impact: 'Avoid performance penalties' });

  if (topReasons[0] && topReasons[0].count >= 3)
    recs.push({ priority: 'medium',
      title: `Top return reason: "${topReasons[0].reason}"`,
      action: `${topReasons[0].count} returns cite this reason. Investigate root cause — product description mismatch, quality issues, or packaging.`,
      impact: '15–30% reduction in return rate' });

  return {
    score: Math.max(0, score),
    findings: {
      total_count:    totalOpen + totalHandled,
      open_count:     totalOpen,
      handled_count:  totalHandled,
      top_reasons:    topReasons,
    },
    recommendations: recs,
  };
}

// ── Seller performance KPIs analysis ─────────────────────────────────────────

interface PerformanceIndicator {
  name: string;
  score: number | null;
  norm: number | null;
  status: string;
}

export function analyzePerformance(indicators: PerformanceIndicator[]): AnalysisResult {
  const needsImprovement = indicators.filter(i => i.status === 'NEEDS_IMPROVEMENT').length;
  const atRisk           = indicators.filter(i => i.status === 'AT_RISK').length;

  const score = Math.max(0, 100 - needsImprovement * 15 - atRisk * 25);

  const recs: AnalysisResult['recommendations'] = [];
  for (const ind of indicators) {
    if (ind.status === 'AT_RISK') {
      recs.push({ priority: 'high',
        title: `${ind.name} is AT RISK`,
        action: `Your ${ind.name} (${ind.score ?? '?'}) is below bol.com's required threshold (${ind.norm ?? '?'}). Immediate action required to avoid account suspension.`,
        impact: 'Avoid seller suspension' });
    } else if (ind.status === 'NEEDS_IMPROVEMENT') {
      recs.push({ priority: 'medium',
        title: `${ind.name} needs improvement`,
        action: `Your ${ind.name} (${ind.score ?? '?'}) is below the target of ${ind.norm ?? '?'}. Act now before it becomes at-risk.`,
        impact: 'Maintain seller account standing' });
    }
  }

  return {
    score,
    findings: {
      indicators_count:   indicators.length,
      at_risk_count:      atRisk,
      needs_improvement:  needsImprovement,
      indicators,
    },
    recommendations: recs,
  };
}

// ── Overall score across categories ──────────────────────────────────────────

export function computeOverallScore(scores: {
  content?: number;
  inventory?: number;
  orders?: number;
  advertising?: number;
  returns?: number;
  performance?: number;
}): number {
  // Weighted scoring (sums to 1.0)
  const weights: Record<string, number> = {
    content:     0.30,
    inventory:   0.25,
    orders:      0.20,
    advertising: 0.15,
    returns:     0.05,
    performance: 0.05,
  };
  let weighted = 0, total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const s = scores[key as keyof typeof scores];
    if (s !== undefined) { weighted += s * weight; total += weight; }
  }
  return total > 0 ? Math.round(weighted / total) : 0;
}
