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
  clientId: string;
  marketId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  clientContext: {
    clientName: string;
    countryCode: string;
    roasTarget: number | null;
    dailyBudgetCap: number | null;
    currency: string;
    amazonAdvertiserProfileId: string;
    amazonAdvertiserAccountId: string;
  };
  memory: Array<{ memory_type: string; content: string }>;
  previousSummary?: string | null;
}

function buildSystemPrompt(
  ctx: ChatRequestBody['clientContext'],
  memory: ChatRequestBody['memory'],
  previousSummary?: string | null
): string {
  const memoryText =
    memory.length > 0
      ? memory
          .map((m) => `[${m.memory_type.toUpperCase()}] ${m.content}`)
          .join('\n')
      : 'No memory items yet.';

  const sessionText = previousSummary
    ? previousSummary
    : 'This is the first session for this client.';

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

  // ── Global chat mode: no specific client, load full portfolio ──────────────
  if (clientId === '__global__') {
    try {
      const supabase = createAdminClient();

      const { data: allClients } = await supabase
        .from('clients')
        .select('name, client_markets(country_code, roas_target, daily_budget_cap, currency, amazon_advertiser_profile_id, amazon_advertiser_account_id, state)')
        .order('name');

      const portfolioText = (allClients ?? []).map((c: Record<string, unknown>) => {
        const mks = (c.client_markets as Record<string, unknown>[] ?? []);
        const rows = mks.map((m: Record<string, unknown>) =>
          `  - ${m.country_code}: Profile ${m.amazon_advertiser_profile_id}, ROAS ${m.roas_target ?? '—'}x, Budget ${m.currency} ${m.daily_budget_cap ?? '—'}/day (${m.state})`
        ).join('\n');
        return `${c.name}:\n${rows || '  (no markets)'}`;
      }).join('\n\n');

      const globalPrompt = `You are a marketplace optimization specialist for Follo, managing Amazon Advertising across a client portfolio.
You have access to all clients' Amazon Ads data via MCP tools.

[CLIENT PORTFOLIO]
${portfolioText}

Your job:
1. Answer questions about any client's performance, budgets, or targets
2. Compare metrics across clients when relevant
3. Use Amazon Profile IDs above to query data via MCP tools
4. Always specify which client/market you're referencing
5. Be concise. Use markdown tables for comparisons.`;

      const globalResponse = await (anthropic.messages.create as Function)({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: globalPrompt,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
        mcp_servers: [{ type: 'url' as const, url: MCP_SERVER_URL, name: 'amazon-ads' }],
      });

      let globalText = '';
      for (const block of globalResponse.content) {
        if (block.type === 'text') globalText += block.text;
      }

      return res.status(200).json({
        content: globalText,
        toolCalls: [],
        proposals: [],
        stopReason: globalResponse.stop_reason,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat/global]', message);
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
