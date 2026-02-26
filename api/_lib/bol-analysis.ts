/**
 * Bol.com Analysis Engine
 * Scores listings, inventory and orders against best-practice thresholds.
 * Ported from the Python skill_2_analysis_engine.py + best_practices.json.
 */

export interface AnalysisResult {
  score: number;                  // 0–100
  findings: Record<string, unknown>;
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; title: string; action: string; impact: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Content analysis (from parsed CSV offers rows) ────────────────────────────

export function analyzeContent(offers: Record<string, string>[]): AnalysisResult {
  if (!offers.length) {
    return { score: 0, findings: { message: 'No offers found', offers_count: 0 }, recommendations: [] };
  }

  const titleScores: number[] = [];
  const priceSet: boolean[] = [];
  const forbiddenKeywords = [
    'Milieuvriendelijk','Eco','Duurzaam','Biologisch afbreekbaar','CO2-neutraal','Klimaatneutraal',
  ];

  for (const offer of offers) {
    const title = offer['title'] ?? offer['Title'] ?? '';
    const len = title.length;

    // Title scoring: 150–175 chars = 100, exists but wrong length = 65, missing = 0
    if (len >= 150 && len <= 175) titleScores.push(100);
    else if (len > 0 && len < 150) titleScores.push(65);
    else if (len > 175) titleScores.push(80); // too long but fixable
    else titleScores.push(0);

    const price = parseFloat(offer['price'] ?? offer['Price'] ?? '0');
    priceSet.push(price > 0);
  }

  const avgTitleScore = avg(titleScores);
  const priceSetPct   = priceSet.filter(Boolean).length / priceSet.length;
  const score         = Math.round(avgTitleScore * 0.7 + priceSetPct * 100 * 0.3);

  const recs: AnalysisResult['recommendations'] = [];
  const shortTitles = titleScores.filter(s => s === 65).length;
  const missingTitles = titleScores.filter(s => s === 0).length;

  if (missingTitles > 0)
    recs.push({ priority: 'high', title: 'Missing product titles',
      action: `${missingTitles} offer(s) have no title. Add a Dutch title of 150–175 chars starting with the brand name.`,
      impact: '15–25% CTR improvement' });

  if (shortTitles > 0)
    recs.push({ priority: 'high', title: 'Short product titles',
      action: `${shortTitles} offer(s) have titles under 150 chars. Expand to 150–175 chars with relevant keywords.`,
      impact: '10–20% CTR improvement' });

  if (priceSetPct < 1)
    recs.push({ priority: 'medium', title: 'Offers missing price',
      action: `${priceSet.filter(v => !v).length} offer(s) have no price set. This disables the Buy Box.`,
      impact: 'Direct sales recovery' });

  return {
    score,
    findings: {
      offers_count: offers.length,
      avg_title_score: Math.round(avgTitleScore),
      titles_in_range: titleScores.filter(s => s === 100).length,
      titles_short: shortTitles,
      titles_missing: missingTitles,
      price_set_pct: Math.round(priceSetPct * 100),
      forbidden_keyword_warning: forbiddenKeywords.some(kw =>
        offers.some(o => (o['title'] ?? '').toLowerCase().includes(kw.toLowerCase()))
      ),
    },
    recommendations: recs,
  };
}

// ── Inventory analysis ────────────────────────────────────────────────────────

interface InventoryItem {
  stock?: { actualStock?: number };
  title?: string;
  offer?: { offerId?: string };
}

export function analyzeInventory(inventory: unknown[]): AnalysisResult {
  if (!inventory.length) {
    return { score: 50, findings: { message: 'No inventory data returned', items_count: 0 }, recommendations: [] };
  }

  const items = inventory as InventoryItem[];
  const stockLevels = items.map(i => i.stock?.actualStock ?? 0);
  const outOfStock  = stockLevels.filter(s => s === 0).length;
  const criticalLow = stockLevels.filter(s => s > 0 && s <= 7).length;   // < 7 days coverage
  const lowStock    = stockLevels.filter(s => s > 7 && s <= 15).length;
  const totalItems  = items.length;

  const healthyPct  = (totalItems - outOfStock - criticalLow) / totalItems;
  const score       = Math.round(healthyPct * 100);

  const recs: AnalysisResult['recommendations'] = [];

  if (outOfStock > 0)
    recs.push({ priority: 'high', title: `${outOfStock} out-of-stock product(s)`,
      action: 'Reorder immediately. Out-of-stock products lose Buy Box and visibility.',
      impact: 'Prevent lost sales from stockouts' });

  if (criticalLow > 0)
    recs.push({ priority: 'high', title: `${criticalLow} critically low stock (<7 days)`,
      action: 'Stock replenishment urgent. Place reorder now before stockout.',
      impact: 'Prevent imminent revenue loss' });

  if (lowStock > 0)
    recs.push({ priority: 'medium', title: `${lowStock} low stock (7–15 days remaining)`,
      action: 'Plan replenishment within the week.',
      impact: 'Maintain stable inventory coverage' });

  const overstock = stockLevels.filter(s => s > 180).length;
  if (overstock > 0)
    recs.push({ priority: 'low', title: `${overstock} product(s) overstocked (>180 days)`,
      action: 'Consider promotional pricing to improve cash flow and reduce storage costs.',
      impact: 'Improved capital efficiency' });

  return {
    score,
    findings: {
      items_count: totalItems,
      out_of_stock: outOfStock,
      critical_low: criticalLow,
      low_stock: lowStock,
      healthy_stock: totalItems - outOfStock - criticalLow - lowStock,
      avg_stock: Math.round(avg(stockLevels)),
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
  if (fbbRate === 0 && total > 10) score -= 10; // no FBB on mature account

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
      orders_count: total,
      cancellations,
      cancel_rate_pct: Math.round(cancelRate * 100),
      fbr_orders: fbrCount,
      fbb_orders: fbbCount,
      fbb_rate_pct: Math.round(fbbRate * 100),
    },
    recommendations: recs,
  };
}

// ── Overall score across categories ──────────────────────────────────────────

export function computeOverallScore(scores: { content?: number; inventory?: number; orders?: number }): number {
  const weights = { content: 0.40, inventory: 0.35, orders: 0.25 };
  let weighted = 0, total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const s = scores[key as keyof typeof scores];
    if (s !== undefined) { weighted += s * weight; total += weight; }
  }
  return total > 0 ? Math.round(weighted / total) : 0;
}
