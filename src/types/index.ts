export interface Client {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  // computed
  market_count?: number;
  pending_proposals?: number;
  last_summary?: string | null;
}

export interface ClientMarket {
  id: string;
  client_id: string;
  country_code: string;
  amazon_advertiser_profile_id: string;
  amazon_advertiser_account_id: string;
  roas_target: number | null;
  daily_budget_cap: number | null;
  currency: string;
  state: 'active' | 'paused';
  notes: string | null;
  created_at: string;
}

export interface AgentMemory {
  id: string;
  client_id: string;
  memory_type: 'goal' | 'rule' | 'decision' | 'note';
  content: string;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
}

export interface Conversation {
  id: string;
  client_id: string;
  market_id: string | null;
  user_id: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: ToolCall[] | null;
  created_at: string;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export type ProposalType =
  | 'bid'
  | 'budget'
  | 'keyword'
  | 'targeting'
  | 'bol_campaign_pause'
  | 'bol_campaign_budget'
  | 'bol_keyword_bid'
  | 'bol_keyword_pause'
  | 'bol_price_adjust';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'executed';
export type ProposalPlatform = 'amazon' | 'bol';

export interface OptimizationProposal {
  id: string;
  platform: ProposalPlatform;
  client_id: string | null;  // Amazon client (null for Bol proposals)
  bol_customer_id: string | null;  // Bol customer (null for Amazon proposals)
  market_id: string | null;
  conversation_id: string | null;
  title: string;
  description: string | null;
  proposal_type: ProposalType;
  current_value: string | null;
  proposed_value: string | null;
  expected_impact: string | null;
  status: ProposalStatus;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  executed_at: string | null;
  amazon_api_payload: Record<string, unknown> | null;
  created_at: string;
}

// Local chat message (before persisting)
export interface LocalMessage {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
}

// Chat mode type for routing
export type ChatMode = 'bol' | 'amazon';
