import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

// Test Anthropic API connection
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        test: 'anthropic-api',
        success: false,
        error: 'ANTHROPIC_API_KEY not set',
      });
    }

    const anthropic = new Anthropic({ apiKey });
    
    // Make minimal API call
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    return res.status(200).json({
      test: 'anthropic-api',
      success: true,
      hasResponse: !!response,
      model: response.model,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      test: 'anthropic-api',
      success: false,
      error: err.message ?? String(err),
      stack: err.stack,
    });
  }
}
