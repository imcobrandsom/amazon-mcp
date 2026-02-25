# Follo Marketplace AI Platform

Internal web app for the Follo team to manage Amazon Advertising campaigns via an AI agent.

## Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS (Vite)
- **Backend**: Vercel Serverless Functions (TypeScript)
- **Database / Auth**: Supabase (PostgreSQL + RLS + Google OAuth)
- **AI**: Claude `claude-sonnet-4-5` with tool use + MCP
- **Amazon Ads**: Amazon Advertising MCP server
- **Automation**: n8n webhook for proposal execution

---

## Prerequisites

- Node.js 18+
- Supabase account
- Vercel account
- Anthropic API key
- Amazon Ads Developer account with an LwA app

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/your-org/follo-marketplace-ai
cd follo-marketplace-ai
npm install
```

### 2. Supabase setup

1. Create a new Supabase project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the migration:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. Go to **Authentication → Providers → Google** and enable Google OAuth.
4. Set the **Authorized redirect URIs** in your Google Cloud OAuth app:
   - `https://your-project.supabase.co/auth/v1/callback`
   - `http://localhost:5173` (local dev)
5. In **Authentication → URL Configuration**, set:
   - Site URL: `https://your-vercel-app.vercel.app`
   - Additional redirect URLs: `http://localhost:5173`
6. Copy your **Project URL** and **anon key** from **Project Settings → API**.

### 3. Amazon Ads credentials

1. Create an LwA (Login with Amazon) application in the [Amazon Ads Developer Console](https://advertising.amazon.com/API/docs/en-us/setting-up/step-1-create-lwa-app).
2. Follow the OAuth2 flow to obtain an initial refresh token (use the [Amazon Ads API Token Generator](https://advertising.amazon.com/API/docs/en-us/setting-up/generate-api-tokens)).
3. Note down: `Client ID`, `Client Secret`, `Refresh Token`.

### 4. Environment variables

```bash
cp .env.example .env.local
```

Fill in all values in `.env.local`. See `.env.example` for descriptions.

> **Note**: Variables prefixed with `VITE_` are exposed to the browser. Never put secret keys in `VITE_` variables.

### 5. Local development

```bash
npm run dev
```

App runs at `http://localhost:5173`.

For API routes locally, use [Vercel CLI](https://vercel.com/docs/cli):
```bash
npm install -g vercel
vercel dev
```
This starts both the Vite dev server and the serverless functions at `http://localhost:3000`.

---

## Vercel Deployment

1. Push to GitHub.
2. Import the repository in [Vercel](https://vercel.com/new).
3. Set framework preset to **Vite**.
4. Add all environment variables from `.env.example` in **Project Settings → Environment Variables**.
5. Deploy.

### Vercel environment variables to add

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Project Settings → API |
| `SUPABASE_URL` | Same as above |
| `SUPABASE_SERVICE_KEY` | Supabase Project Settings → API → service_role key |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `AMAZON_CLIENT_ID` | Amazon LwA app |
| `AMAZON_CLIENT_SECRET` | Amazon LwA app |
| `AMAZON_REFRESH_TOKEN` | Amazon OAuth2 flow |
| `N8N_PROPOSAL_WEBHOOK_URL` | Your n8n instance |

---

## Project Structure

```
├── api/                        # Vercel serverless functions
│   ├── _lib/
│   │   ├── amazon-token.ts     # OAuth2 token refresh + caching
│   │   └── supabase-admin.ts   # Server-side Supabase client
│   ├── chat.ts                 # Claude agent endpoint
│   ├── conversation-summary.ts # Auto-summary generation
│   ├── proposal.ts             # Proposal approve/reject/execute
│   └── token-refresh.ts        # Amazon token endpoint
├── src/
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatInterface.tsx   # Main chat UI
│   │   │   ├── MessageBubble.tsx   # Message renderer w/ markdown
│   │   │   └── MemoryPanel.tsx     # Agent memory management
│   │   ├── Proposals/
│   │   │   ├── ProposalsPanel.tsx  # Proposals list + filter
│   │   │   └── ProposalCard.tsx    # Individual proposal card
│   │   ├── ClientCard.tsx
│   │   └── Layout.tsx
│   ├── contexts/
│   │   └── AuthContext.tsx         # Google OAuth + domain check
│   ├── hooks/
│   │   ├── useClients.ts
│   │   └── useClientDetail.ts
│   ├── lib/
│   │   ├── api.ts                  # Frontend API calls
│   │   └── supabase.ts             # Supabase client
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── ClientOverview.tsx
│   │   ├── ClientDetail.tsx
│   │   └── ConversationHistory.tsx
│   └── types/index.ts
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Full DB schema + RLS
├── .env.example
└── vercel.json
```

---

## Key Features

### Authentication
- Google OAuth via Supabase Auth
- Email domain restricted to `@folloagency.com`
- User avatar and name from Google profile

### AI Agent
- Claude `claude-sonnet-4-5` with tool use
- Connected to Amazon Ads MCP server (`https://advertising-ai-eu.amazon.com/mcp`)
- Auto-refreshing Amazon access tokens (1-hour expiry handled server-side)
- Per-client memory system (goals, rules, decisions, notes)
- Previous conversation summaries injected into each new session

### Proposals Workflow
1. Agent identifies an optimization opportunity
2. Agent confirms with user before submitting
3. Agent calls `create_proposal` tool → saved to DB
4. Team member reviews in Proposals panel → Approve / Reject
5. Approved proposals can be executed → fires n8n webhook

### Database
- Full RLS policies — authenticated users only
- All tables include indexes for common query patterns

---

## n8n Integration

When a proposal is executed, the `/api/proposal` endpoint fires a `POST` to `N8N_PROPOSAL_WEBHOOK_URL` with:

```json
{
  "proposal": { ...full proposal object... },
  "triggeredAt": "2025-06-01T12:00:00.000Z"
}
```

Build an n8n workflow that receives this webhook and uses the `amazon_api_payload` field to call the Amazon Ads API.

---

## Development Notes

- API routes in `/api/` run as Vercel Node.js serverless functions
- Amazon token is cached in module-level state (per function instance, ~15min warm)
- For production, consider storing token in Redis/KV for cross-instance sharing
- The `mcp_servers` parameter in the Claude API call requires Claude SDK ≥ 0.32
