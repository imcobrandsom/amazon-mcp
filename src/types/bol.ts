// ── Bol.com domain types ──────────────────────────────────────────────────────

export interface BolCustomer {
  id: string;
  client_id: string | null;   // FK to clients.id — null = not linked yet
  seller_name: string;
  bol_client_id: string;
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
  data_type: 'listings' | 'inventory' | 'orders' | 'offer_insights';
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
  category: 'content' | 'inventory' | 'orders' | 'advertising';
  score: number;
  findings: Record<string, unknown>;
  recommendations: BolRecommendation[];
  analyzed_at: string;
}

// Convenience: latest analysis per category for one customer
export interface BolCustomerAnalysisSummary {
  customer: BolCustomer;
  content:   BolAnalysis | null;
  inventory: BolAnalysis | null;
  orders:    BolAnalysis | null;
  overall_score: number | null;
  last_sync_at: string | null;
}
