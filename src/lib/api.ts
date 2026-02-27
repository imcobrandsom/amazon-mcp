import type {
  ClientMarket,
  AgentMemory,
  LocalMessage,
  OptimizationProposal,
  ProposalStatus,
} from '../types';

const BASE = '/api';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Chat ----

export interface ChatResponse {
  content: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; id: string }>;
  proposals: OptimizationProposal[];
  stopReason: string;
}

export function sendChatMessage(params: {
  conversationId: string;
  clientId: string;
  marketId: string;
  messages: LocalMessage[];
  clientContext: ClientMarket & { clientName: string };
  memory: AgentMemory[];
  previousSummary?: string | null;
}): Promise<ChatResponse> {
  return post<ChatResponse>('/chat', {
    conversationId: params.conversationId,
    clientId: params.clientId,
    marketId: params.marketId,
    messages: params.messages,
    clientContext: {
      clientName: params.clientContext.clientName,
      countryCode: params.clientContext.country_code,
      roasTarget: params.clientContext.roas_target,
      dailyBudgetCap: params.clientContext.daily_budget_cap,
      currency: params.clientContext.currency,
      amazonAdvertiserProfileId:
        params.clientContext.amazon_advertiser_profile_id,
      amazonAdvertiserAccountId:
        params.clientContext.amazon_advertiser_account_id,
    },
    memory: params.memory,
    previousSummary: params.previousSummary,
  });
}

// Global chat (no specific client — Claude sees all clients)
// Can also be used for Bol.com customer-specific chat
export function sendGlobalChatMessage(params: {
  messages: LocalMessage[];
  chatMode: 'bol' | 'amazon';
  bolCustomerId?: string;
  bolFilters?: {
    dateRange?: { from: string; to: string };
    campaignState?: string;
  };
}): Promise<ChatResponse> {
  return post<ChatResponse>('/chat', {
    conversationId: '__global__',
    clientId: '__global__',
    marketId: '__global__',
    chatMode: params.chatMode,
    messages: params.messages,
    clientContext: {
      clientName: 'Global',
      countryCode: '',
      roasTarget: null,
      dailyBudgetCap: null,
      currency: '',
      amazonAdvertiserProfileId: '',
      amazonAdvertiserAccountId: '',
    },
    memory: [],
    previousSummary: null,
    // Bol.com-specific fields
    bolCustomerId: params.bolCustomerId,
    bolFilters: params.bolFilters,
  });
}

// ---- Conversation summary ----

export function generateSummary(params: {
  conversationId: string;
  messages: LocalMessage[];
}): Promise<{ summary: string }> {
  return post<{ summary: string }>('/conversation-summary', params);
}

// ---- Proposal actions ----

export function updateProposalStatus(params: {
  proposalId: string;
  action: 'approve' | 'reject' | 'execute';
  reviewedBy: string;
}): Promise<{ proposal: OptimizationProposal }> {
  return patch<{ proposal: OptimizationProposal }>('/proposal', params);
}

// ---- Status type helper ----
export function statusLabel(status: ProposalStatus): string {
  return { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', executed: 'Executed' }[status];
}
