import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from './_lib/supabase-admin.js';
import { getAmazonAccessToken } from './_lib/amazon-token.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'mcp-client-2025-04-04' },
});

// Proxy URL — injects Amazon auth headers before forwarding to Amazon's MCP
const MCP_SERVER_URL = `${process.env.APP_URL}/api/amazon-mcp-proxy`;

interface ChatRequestBody {
  conversationId: string;
  clientId?: string;  // Amazon client (optional - may use bolCustomerId instead)
  marketId?: string;  // Amazon market
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  clientContext?: {  // Amazon client context (optional)
    clientName: string;
    countryCode: string;
    roasTarget: number | null;
    dailyBudgetCap: number | null;
    currency: string;
    amazonAdvertiserProfileId: string;
    amazonAdvertiserAccountId: string;
  };
  memory?: Array<{ memory_type: string; content: string }>;
  previousSummary?: string | null;
  // Bol.com-specific fields
  bolCustomerId?: string;
  bolFilters?: {
    dateRange?: { from: string; to: string };
    campaignState?: string;
  };
}

function buildSystemPrompt(
  ctx: ChatRequestBody['clientContext'],
  memory: ChatRequestBody['memory'],
  previousSummary?: string | null
): string {
  const memoryText =
    memory && memory.length > 0
      ? memory
          .map((m) => `[${m.memory_type.toUpperCase()}] ${m.content}`)
          .join('\n')
      : 'No memory items yet.';

  const sessionText = previousSummary
    ? previousSummary
    : 'This is the first session for this client.';

  if (!ctx) {
    return 'You are a marketplace optimization specialist working for Follo.';
  }

  return `You are a marketplace optimization specialist working for Follo, a digital agency managing Amazon Advertising for 20+ brands across Europe.
You have access to Amazon Advertising data for the current client via MCP tools.

[CLIENT CONTEXT]
Client: ${ctx.clientName}
Market: ${ctx.countryCode}
ROAS Target: ${ctx.roasTarget ?? 'Not set'}
Daily Budget Cap: ${ctx.dailyBudgetCap ?? 'Not set'} ${ctx.currency}
Amazon Profile ID: ${ctx.amazonAdvertiserProfileId}
Amazon Account ID: ${ctx.amazonAdvertiserAccountId}

[CLIENT MEMORY]
${memoryText}

[PREVIOUS SESSION]
${sessionText}

Your job:
1. Answer questions about campaign performance, budgets, keywords, targets
2. Proactively identify optimization opportunities
3. When you identify an optimization, structure it as a formal proposal with: title, description, current value, proposed value, expected impact. Always ask for confirmation before submitting a proposal.
4. Be concise. Use markdown tables for data comparisons. Avoid walls of text.
5. Always be aware of the client's ROAS target and budget rules when making proposals.
6. Never execute changes directly — only propose them.

When you want to create a proposal (after user confirmation), call the create_proposal tool with the required fields.`;
}

async function buildBolSystemPrompt(
  customerId: string,
  memory: Array<{ memory_type: string; content: string }> = [],
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  // Load Bol customer details
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('seller_name')
    .eq('id', customerId)
    .single();

  const memoryText =
    memory.length > 0
      ? memory.map((m) => `[${m.memory_type.toUpperCase()}] ${m.content}`).join('\n')
      : 'No memory items yet.';

  return `You are a Bol.com advertising specialist working for Follo, a digital agency managing Bol.com seller accounts.

CRITICAL: You have access ONLY to Bol.com data. You do NOT have access to Amazon Ads data.
- DO NOT mention Amazon, Amazon Ads, or Amazon profiles
- DO NOT attempt to use Amazon MCP tools
- ONLY use the bol_* tools available to you

[CUSTOMER CONTEXT]
Seller: ${customer?.seller_name ?? 'Unknown'}
Customer ID: ${customerId}

[CUSTOMER MEMORY]
${memoryText}

IMPORTANT GUIDELINES:
- Use bol_analyze_* tools to fetch current data before answering questions
- NEVER use analysis.findings for statistics - always compute from raw data returned by tools
- When creating proposals, provide clear rationale and estimated impact in euros
- For portfolio queries, call tools without customer_id to analyze all customers
- Be specific about date ranges when analyzing trends
- Always show monetary values in euros (€)

Your job:
1. Answer questions about Bol.com campaign performance, product quality, competitor positioning
2. Proactively identify optimization opportunities (pause low-ROAS keywords, adjust bids, fix content)
3. When you identify an optimization, ask for user confirmation, then call bol_create_proposal
4. Be concise. Use markdown tables for data comparisons.
5. Never execute changes directly — only propose them.

Available tools (BOL.COM ONLY):
- bol_analyze_campaigns: Get campaign and keyword performance metrics
- bol_analyze_products: Check product catalog quality (titles, prices, stock)
- bol_analyze_competitors: Review competitor pricing and buy box status
- bol_get_keyword_rankings: Check search ranking trends
- bol_create_proposal: Submit optimization proposal for approval`;
}

async function buildBolPortfolioSystemPrompt(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  // Load all active Bol customers for context
  const { data: customers } = await supabase
    .from('bol_customers')
    .select('id, seller_name')
    .eq('active', true)
    .order('seller_name');

  const customerList = customers
    ?.map(c => `- ${c.seller_name} (ID: ${c.id})`)
    .join('\n') || 'No customers found';

  return `You are a Bol.com advertising specialist for Follo agency analyzing ALL Bol.com customers.

CRITICAL: You have access ONLY to Bol.com data across all customers.
- DO NOT mention Amazon, Amazon Ads, or Amazon profiles
- DO NOT attempt to use Amazon MCP tools
- ONLY use the bol_* tools available to you

[AVAILABLE CUSTOMERS]
${customerList}

IMPORTANT GUIDELINES:
- Use bol_analyze_* tools WITHOUT customer_id parameter to analyze across all customers
- When analyzing specific customers, use their customer_id
- Compare performance metrics across customers to identify outliers
- Always show monetary values in euros (€)
- NEVER use analysis.findings for statistics - always compute from raw data returned by tools

Your job:
1. Answer questions about Bol.com campaign performance across the portfolio
2. Compare customers to identify underperformers and top performers
3. Proactively identify portfolio-wide optimization opportunities
4. When creating proposals, specify which customer(s) they apply to
5. Be concise. Use markdown tables for comparisons.

Available tools (BOL.COM ONLY):
- bol_analyze_campaigns: Get campaign and keyword performance (omit customer_id for all customers)
- bol_analyze_products: Check product catalog quality (requires customer_id)
- bol_analyze_competitors: Review competitor pricing and buy box (requires customer_id)
- bol_get_keyword_rankings: Check search ranking trends (requires customer_id)
- bol_create_proposal: Submit optimization proposal for specific customer`;
}

const SUGGEST_CLIENT_TOOL: Anthropic.Tool = {
  name: 'suggest_client_setup',
  description:
    'Call this tool whenever you have retrieved advertiser account or profile information from Amazon Ads (e.g. after calling list_advertiser_accounts or query_advertiser_account). Use it to surface a one-click "Add Client" card to the user with the profile data pre-filled.',
  input_schema: {
    type: 'object' as const,
    properties: {
      clientName: {
        type: 'string',
        description: 'Suggested client/brand name derived from the advertiser account name',
      },
      accountId: {
        type: 'string',
        description: 'Amazon advertiser account ID (if available)',
      },
      markets: {
        type: 'array',
        description: 'One entry per marketplace/profile found',
        items: {
          type: 'object',
          properties: {
            country_code: { type: 'string', description: 'ISO 3166-1 alpha-2 country code, e.g. NL' },
            profile_id: { type: 'string', description: 'Amazon Advertiser Profile ID' },
            currency: { type: 'string', description: 'Currency code, e.g. EUR' },
          },
          required: ['country_code', 'profile_id', 'currency'],
        },
      },
    },
    required: ['clientName', 'markets'],
  },
};

const PROPOSAL_TOOL: Anthropic.Tool = {
  name: 'create_proposal',
  description:
    'Submit a structured optimization proposal. Only call this after the user has confirmed they want to proceed with the proposal.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short title for the proposal' },
      description: {
        type: 'string',
        description: 'Detailed explanation of the optimization',
      },
      proposal_type: {
        type: 'string',
        enum: ['bid', 'budget', 'keyword', 'targeting'],
        description: 'Category of the optimization',
      },
      current_value: {
        type: 'string',
        description: 'Current setting or value being changed',
      },
      proposed_value: {
        type: 'string',
        description: 'The proposed new value',
      },
      expected_impact: {
        type: 'string',
        description: 'Expected outcome (e.g. +15% ROAS, -10% wasted spend)',
      },
      amazon_api_payload: {
        type: 'object',
        description:
          'Optional: structured Amazon Ads API payload for execution via n8n',
      },
    },
    required: [
      'title',
      'description',
      'proposal_type',
      'current_value',
      'proposed_value',
      'expected_impact',
    ],
  },
};

// ── Bol.com Tools ─────────────────────────────────────────────────────────────

const BOL_ANALYZE_CAMPAIGNS_TOOL: Anthropic.Tool = {
  name: 'bol_analyze_campaigns',
  description: 'Analyze Bol.com advertising campaign performance. Returns campaigns and keywords with spend, revenue, ACOS, ROAS, CTR metrics. Omit customer_id for portfolio-wide analysis.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_id: { type: 'string', description: 'Bol customer UUID (optional - omit for all customers)' },
      date_range_days: { type: 'number', description: 'Days of history to analyze (default: 30, max: 180)' },
      filters: {
        type: 'object',
        properties: {
          min_spend: { type: 'number' },
          max_acos: { type: 'number' },
          campaign_state: { type: 'string', enum: ['enabled', 'paused', 'archived'] },
        },
      },
    },
  },
};

const BOL_ANALYZE_PRODUCTS_TOOL: Anthropic.Tool = {
  name: 'bol_analyze_products',
  description: 'Analyze Bol.com product catalog quality (titles, descriptions, prices, stock levels). Use to identify content gaps or inventory issues.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_id: { type: 'string', description: 'Bol customer UUID' },
      filters: {
        type: 'object',
        properties: {
          missing_titles: { type: 'boolean' },
          missing_descriptions: { type: 'boolean' },
          out_of_stock: { type: 'boolean' },
          eol_only: { type: 'boolean' },
          fulfillment_method: { type: 'string', enum: ['FBR', 'FBB'] },
        },
      },
    },
    required: ['customer_id'],
  },
};

const BOL_ANALYZE_COMPETITORS_TOOL: Anthropic.Tool = {
  name: 'bol_analyze_competitors',
  description: 'Analyze competitor pricing and buy box status for Bol.com products.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_id: { type: 'string', description: 'Bol customer UUID' },
      ean: { type: 'string', description: 'Specific EAN to analyze (optional - omit for catalog-wide)' },
      focus: { type: 'string', enum: ['buy_box_losses', 'price_undercut', 'new_competitors'] },
    },
    required: ['customer_id'],
  },
};

const BOL_GET_KEYWORD_RANKINGS_TOOL: Anthropic.Tool = {
  name: 'bol_get_keyword_rankings',
  description: 'Retrieve keyword ranking trends to identify SEO opportunities or losses.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_id: { type: 'string', description: 'Bol customer UUID' },
      ean: { type: 'string' },
      trend_direction: { type: 'string', enum: ['improving', 'declining', 'stable'] },
    },
    required: ['customer_id'],
  },
};

const BOL_CREATE_PROPOSAL_TOOL: Anthropic.Tool = {
  name: 'bol_create_proposal',
  description: 'Create an optimization proposal for Bol.com campaigns. Requires user approval before execution.',
  input_schema: {
    type: 'object' as const,
    properties: {
      customer_id: { type: 'string' },
      proposal_type: {
        type: 'string',
        enum: ['bol_campaign_pause', 'bol_campaign_budget', 'bol_keyword_bid', 'bol_keyword_pause', 'bol_price_adjust'],
      },
      description: { type: 'string', description: 'User-friendly explanation of WHY this change is recommended' },
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            campaign_id: { type: 'string' },
            keyword: { type: 'string' },
            ean: { type: 'string' },
            current_value: { type: 'number' },
            proposed_value: { type: 'number' },
            rationale: { type: 'string' },
          },
        },
      },
      estimated_impact: {
        type: 'object',
        properties: {
          spend_change_pct: { type: 'number' },
          acos_change_pct: { type: 'number' },
        },
      },
    },
    required: ['customer_id', 'proposal_type', 'description', 'changes'],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body: ChatRequestBody = req.body;
  const {
    conversationId,
    clientId,
    marketId,
    messages,
    clientContext,
    memory,
    previousSummary,
  } = body;

  if (!messages?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ── Bol.com chat mode: customer-specific or portfolio ─────────────────────
  const { chatMode, bolCustomerId, bolFilters } = body;

  if (chatMode === 'bol') {
    try {
      const supabase = createAdminClient();

      // Load memory if customer-specific
      let memory: Array<{ memory_type: string; content: string }> = [];
      if (bolCustomerId) {
        const { data: memoryData } = await supabase
          .from('agent_memory')
          .select('memory_type, content')
          .eq('entity_id', bolCustomerId)
          .eq('entity_type', 'bol_customer')
          .eq('is_active', true);
        memory = memoryData ?? [];
      }

      const systemPrompt = bolCustomerId
        ? await buildBolSystemPrompt(bolCustomerId, memory, supabase)
        : await buildBolPortfolioSystemPrompt(supabase);
- DO NOT mention Amazon, Amazon Ads, or Amazon profiles
- DO NOT attempt to use Amazon MCP tools
- ONLY use the bol_* tools available to you

Use bol_analyze_* tools to analyze performance across customers or for specific customers.
Always show monetary values in euros (€).

Available tools (BOL.COM ONLY):
- bol_analyze_campaigns: Get campaign and keyword performance metrics
- bol_analyze_products: Check product catalog quality (titles, prices, stock)
- bol_analyze_competitors: Review competitor pricing and buy box status
- bol_get_keyword_rankings: Check search ranking trends
- bol_create_proposal: Submit optimization proposal for approval`;

      const bolTools = [
        BOL_ANALYZE_CAMPAIGNS_TOOL,
        BOL_ANALYZE_PRODUCTS_TOOL,
        BOL_ANALYZE_COMPETITORS_TOOL,
        BOL_GET_KEYWORD_RANKINGS_TOOL,
        BOL_CREATE_PROPOSAL_TOOL,
      ];

      const bolResponse = await (anthropic.messages.create as Function)({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: systemPrompt,
        tools: bolTools,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      });

      // Extract text and tool calls
      let textContent = '';
      const toolCalls: Array<{ name: string; input: Record<string, unknown>; id: string }> = [];
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

      for (const block of bolResponse.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name,
            input: block.input as Record<string, unknown>,
            id: block.id,
          });

          // Execute Bol tool immediately
          if (block.name.startsWith('bol_')) {
            const { handleBolTool } = await import('./_lib/bol-agent-tools.js');
            try {
              const result = await handleBolTool(block.name, block.input, {
                bolCustomerId,
                conversationId,
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            } catch (toolError: unknown) {
              const errorMsg = toolError instanceof Error ? toolError.message : 'Tool execution failed';
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: errorMsg }),
              });
            }
          }
        }
      }

      // If we have tool results, make a second call to Claude to get the final response
      if (toolResults.length > 0) {
        const followUpResponse = await (anthropic.messages.create as Function)({
          model: 'claude-sonnet-4-5',
          max_tokens: 4096,
          system: systemPrompt,
          tools: bolTools,
          messages: [
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role,
              content: m.content,
            })),
            {
              role: 'assistant',
              content: bolResponse.content,
            },
            {
              role: 'user',
              content: toolResults,
            },
          ],
        });

        // Extract final text
        textContent = '';
        for (const block of followUpResponse.content) {
          if (block.type === 'text') {
            textContent += block.text;
          }
        }
      }

      return res.status(200).json({
        content: textContent,
        toolCalls,
        proposals: [],
        stopReason: bolResponse.stop_reason,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat/bol]', message);
      return res.status(500).json({ error: message });
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (!conversationId || !clientId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const supabase = createAdminClient();
    const accessToken = await getAmazonAccessToken();

    // Build the MCP server config for Claude (auth handled by our proxy)
    const mcpServers = [
      {
        type: 'url' as const,
        url: MCP_SERVER_URL,
        name: 'amazon-ads',
      },
    ];

    const systemPrompt = buildSystemPrompt(
      clientContext,
      memory,
      previousSummary
    );

    // Call Claude with tool use + MCP
    const response = await (anthropic.messages.create as Function)({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      tools: [PROPOSAL_TOOL],
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      mcp_servers: mcpServers,
    });

    // Extract text content and tool calls
    let textContent = '';
    const toolCalls: Array<{ name: string; input: Record<string, unknown>; id: string }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          input: block.input as Record<string, unknown>,
          id: block.id,
        });
      }
    }

    // Save assistant message to DB
    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: textContent || '[Tool use]',
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
    });

    if (msgError) {
      console.error('[chat] Failed to save message:', msgError);
    }

    // Handle create_proposal tool calls
    const createdProposals: Array<Record<string, unknown>> = [];
    for (const tc of toolCalls) {
      if (tc.name === 'create_proposal') {
        const proposalInput = tc.input as {
          title: string;
          description: string;
          proposal_type: string;
          current_value: string;
          proposed_value: string;
          expected_impact: string;
          amazon_api_payload?: Record<string, unknown>;
        };

        const { data: proposal, error: propError } = await supabase
          .from('optimization_proposals')
          .insert({
            client_id: clientId,
            market_id: marketId || null,
            conversation_id: conversationId,
            title: proposalInput.title,
            description: proposalInput.description,
            proposal_type: proposalInput.proposal_type,
            current_value: proposalInput.current_value,
            proposed_value: proposalInput.proposed_value,
            expected_impact: proposalInput.expected_impact,
            amazon_api_payload: proposalInput.amazon_api_payload || null,
            status: 'pending',
            // created_by comes from the authenticated user context —
            // for server-side, we skip it and rely on the frontend
          })
          .select()
          .single();

        if (propError) {
          console.error('[chat] Failed to save proposal:', propError);
        } else {
          createdProposals.push(proposal);
        }
      }
    }

    return res.status(200).json({
      content: textContent,
      toolCalls,
      proposals: createdProposals,
      stopReason: response.stop_reason,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat]', message);
    return res.status(500).json({ error: message });
  }
}
