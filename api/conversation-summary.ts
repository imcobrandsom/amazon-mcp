import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from './_lib/supabase-admin.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface SummaryRequestBody {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId, messages }: SummaryRequestBody = req.body;

  if (!conversationId || !messages?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Please summarize the following conversation in 3-5 sentences. Focus on: what was discussed, key findings, decisions made, and any proposals created. Be concise and factual.\n\n---\n${transcript}`,
        },
      ],
    });

    const summaryBlock = response.content.find((b) => b.type === 'text');
    const summary = summaryBlock?.type === 'text' ? summaryBlock.text : '';

    // Save summary to conversations table
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('conversations')
      .update({ summary, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    if (error) {
      console.error('[summary] Failed to update conversation:', error);
    }

    return res.status(200).json({ summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[summary]', message);
    return res.status(500).json({ error: message });
  }
}
