// ── Bol.com domain types ──────────────────────────────────────────────────────

export interface BolCustomer {
  id: string;
  client_id: string | null;   // FK to clients.id — null = not linked yet
  seller_name: string;
  bol_client_id: string;
  ads_client_id: string | null;  // Advertising API client ID (secret never exposed)
  active: boolean;
  sync_interval_hours: number;
  last_sync_at: string | null;
  created_at: string;
  // Joined
  clients?: { id: string; name: string } | null;
}

export type BolSyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BolSyncJob {
  id: string;
  bol_customer_id: string;
  data_type: 'listings' | 'inventory' | 'orders' | 'offer_insights' | 'advertising' | 'returns' | 'performance';
  process_status_id: string | null;
  entity_id: string | null;
  status: BolSyncJobStatus;
  attempts: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface BolRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  impact: string;
}

export interface BolAnalysis {
  id: string;
  bol_customer_id: string;
  snapshot_id: string | null;
  category: 'content' | 'inventory' | 'orders' | 'advertising' | 'returns' | 'performance';
  score: number;
  findings: Record<string, unknown>;
  recommendations: BolRecommendation[];
  analyzed_at: string;
}

// Convenience: latest analysis per category for one customer
export interface BolCustomerAnalysisSummary {
  customer:    BolCustomer;
  content:     BolAnalysis | null;
  inventory:   BolAnalysis | null;
  orders:      BolAnalysis | null;
  advertising: BolAnalysis | null;
  returns:     BolAnalysis | null;
  performance: BolAnalysis | null;
  overall_score: number | null;
  last_sync_at: string | null;
}

// ── Product (joined inventory + listings) ─────────────────────────────────────

export interface BolProduct {
  ean: string;
  bsku: string | null;
  title: string | null;
  gradedStock: number;
  regularStock: number;
  offerId: string | null;
  price: number | null;
  fulfilmentType: 'FBB' | 'FBR' | null;
  stockAmount: number | null;
  onHold: boolean;
}

// ── Campaign / keyword time-series ────────────────────────────────────────────

export interface BolCampaignPerformance {
  id: string;
  bol_customer_id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_type: string | null;   // 'MANUAL' | 'AUTOMATIC'
  state: string | null;           // 'ENABLED' | 'PAUSED' | 'ARCHIVED'
  budget: number | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr_pct: number | null;
  avg_cpc: number | null;
  revenue: number | null;
  roas: number | null;
  acos: number | null;
  conversions: number | null;
  cvr_pct: number | null;
  synced_at: string;
}

export interface BolKeywordPerformance {
  id: string;
  bol_customer_id: string;
  keyword_id: string;
  keyword_text: string | null;
  match_type: string | null;      // 'EXACT' | 'PHRASE'
  campaign_id: string;
  ad_group_id: string | null;
  bid: number | null;
  state: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  revenue: number | null;
  acos: number | null;
  conversions: number | null;
  synced_at: string;
}

// ── Campaign chart point (daily aggregate) ────────────────────────────────────

export interface BolCampaignChartPoint {
  date: string;        // 'YYYY-MM-DD'
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  ctr_pct: number;
}

// ── Competitor snapshot ───────────────────────────────────────────────────────

export interface BolCompetitorSnapshot {
  id: string;
  bol_customer_id: string;
  ean: string;
  offer_id: string | null;
  our_price: number | null;
  lowest_competing_price: number | null;
  buy_box_winner: boolean | null;
  competitor_count: number | null;
  competitor_prices: Array<{
    offerId?: string;
    sellerId?: string;
    price?: number | null;
    condition?: string;
    isBuyBoxWinner?: boolean;
  }> | null;
  rating_score: number | null;
  rating_count: number | null;
  fetched_at: string;
}

// ── Keyword ranking ───────────────────────────────────────────────────────────

export interface BolKeywordRanking {
  ean: string;
  search_type: 'SEARCH' | 'BROWSE';
  current_rank: number | null;
  prev_rank: number | null;
  current_impressions: number | null;
  trend: 'up' | 'down' | 'stable' | 'new';
}
