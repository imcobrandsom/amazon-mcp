import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAmazonAccessToken } from './_lib/amazon-token.js';

export const config = {
  api: { bodyParser: false },
};

const AMAZON_MCP_URL = 'https://advertising-ai-eu.amazon.com/mcp';

/**
 * POST /api/amazon-mcp-proxy
 * Proxies MCP requests to Amazon's MCP server, injecting the required
 * Amazon auth headers (Authorization + Amazon-Advertising-API-ClientId).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accessToken = await getAmazonAccessToken();
    const clientId = process.env.AMAZON_CLIENT_ID!;

    // Read raw request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const rawBody = Buffer.concat(chunks);

    // Forward to Amazon MCP with both required auth headers
    const upstream = await fetch(AMAZON_MCP_URL, {
      method: req.method ?? 'POST',
      headers: {
        'Content-Type': (req.headers['content-type'] as string) ?? 'application/json',
        'Accept': (req.headers['accept'] as string) ?? 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': clientId,
      },
      body: rawBody.length > 0 ? rawBody : undefined,
    });

    res.status(upstream.status);

    // Forward response headers, skipping ones that cause issues with Node streams
    const skipHeaders = new Set(['content-encoding', 'transfer-encoding', 'connection', 'keep-alive']);
    upstream.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Stream response body back
    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    console.error('[amazon-mcp-proxy]', message);
    res.status(500).json({ error: message });
  }
}
