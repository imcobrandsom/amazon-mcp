# CLAUDE.md — Follo Marketplace AI Platform

Developer guide for Claude Code sessions. Read this before making changes.

---

## Project Overview

Internal tool for Follo agency to manage **Amazon Advertising** (via Claude AI + MCP) and a **Bol.com seller dashboard** with sync, analytics, and AI-generated recommendations.

**Stack:** React 18 + TypeScript + Tailwind (Vite) → Vercel · Supabase (Postgres + Auth + RLS) · Claude claude-sonnet-4-5 · Vercel serverless API routes

**Run locally:** `vercel dev` (not `vite dev` — API routes need Vercel CLI)

---

## File Map

### API routes (`/api/`)

| File | Purpose |
|---|---|
| `chat.ts` | Main Claude agent endpoint; MCP + `create_proposal` tool interception |
| `bol-customers.ts` | CRUD for bol.com seller accounts |
| `bol-sync-trigger.ts` | Dashboard-initiated manual sync (main / complete / extended) |
| `bol-sync-start.ts` | Initiates async bol.com export jobs (step 1 of 2-step pattern) |
| `bol-sync-complete.ts` | Polls & downloads completed export jobs (step 2) |
| `bol-sync-extended.ts` | Competitors, keyword rankings, catalog enrichment |
| `bol-sync-manual.ts` | External webhook-triggered sync |
| `bol-campaigns.ts` | Latest campaign + keyword performance (deduplicated) |
| `bol-campaigns-chart.ts` | Daily aggregated time-series for trend charts |
| `bol-products.ts` | Product list joining inventory + listings snapshots on EAN |
| `bol-analyses.ts` | AI-generated analysis summaries per category |
| `bol-competitors.ts` | Latest competitor snapshots per EAN |
| `bol-keywords.ts` | Keyword rankings with trend calculations |
| `amazon-connect.ts` | Amazon Ads LwA OAuth2 flow |
| `amazon-callback.ts` | Amazon OAuth callback; stores refresh token |
| `token-refresh.ts` | Amazon access token refresh (module-level cache) |
| `proposal.ts` | Approve/reject/execute proposals; fires n8n webhook |
| `conversation-summary.ts` | Auto-summary when user leaves chat |

### API helpers (`/api/_lib/`)

| File | Purpose |
|---|---|
| `supabase-admin.ts` | Supabase admin client (service role) for server-side access |
| `amazon-token.ts` | Amazon OAuth2 token caching (~15 min, module-level) |
| `bol-api-client.ts` | Full Bol.com Retailer + Advertising API client (auth, exports, CSV parsing) |
| `bol-analysis.ts` | AI scoring engine: analyzes content, inventory, orders, ads, returns, performance |

### Frontend

```
src/
├── pages/
│   ├── BolDashboard.tsx          ← main bol.com dashboard (most active file)
│   ├── ClientOverview.tsx
│   ├── ClientDetail.tsx
│   ├── ConversationHistory.tsx
│   ├── Settings.tsx
│   └── Login.tsx
├── components/
│   ├── Layout.tsx
│   ├── ClientCard.tsx
│   ├── Chat/                     ← ChatInterface, GlobalChatPanel, MessageBubble, MemoryPanel
│   ├── Proposals/                ← ProposalsPanel, ProposalCard
│   └── Bol/
│       └── BolSection.tsx
├── lib/
│   ├── bol-api.ts               ← fetch wrappers for all bol API endpoints
│   ├── api.ts                   ← fetch wrappers for chat/proposals
│   └── supabase.ts              ← Supabase client (anon key)
└── types/
    ├── bol.ts                   ← all Bol.com domain types
    └── index.ts                 ← core types (Client, Conversation, Proposal, etc.)
```

---

## Supabase Tables

### Core (Amazon Ads)
- **`clients`** — Follo client accounts
- **`client_markets`** — per-country Amazon Ads profiles (advertiser IDs, ROAS target, budget cap)
- **`conversations`** — chat sessions (linked to client + optional market)
- **`messages`** — chat messages with `tool_calls` JSONB
- **`agent_memory`** — per-client goals/rules/decisions/notes for Claude
- **`optimization_proposals`** — AI proposals with status pending→approved→executed
- **`amazon_credentials`** — single-row OAuth tokens table

### Bol.com
- **`bol_customers`** — seller accounts with Retailer + Advertising API credentials
- **`bol_sync_jobs`** — async export job tracking (2-step pattern)
- **`bol_raw_snapshots`** — raw API responses as JSONB (audit trail, data_type = listings/inventory/orders/etc.)
- **`bol_analyses`** — AI analysis results: `score` (0-100) + `findings` (JSONB) + `recommendations` array
- **`bol_campaign_performance`** — **time-series**: one row per campaign per sync run
- **`bol_keyword_performance`** — **time-series**: one row per keyword per sync run
- **`bol_competitor_snapshots`** — per-EAN competing offers with prices + buy box
- **`bol_keyword_rankings`** — per-EAN search/browse rank history

---

## Critical: The Two-Data-Source Problem

This bites you constantly. There are two data sources for bol.com data, and they have different qualities:

### Source A: `bol_analyses.findings` (JSONB blob)
- Computed by `api/_lib/bol-analysis.ts` from CSV exports
- **Problem:** The bol.com CSV export does NOT include titles or reliable prices for FBB (Fulfilled by Bol) sellers
- **Result:** `analysis.findings` shows wrong counts (e.g. "306 titles missing" when they're actually set)
- **Use for:** Recommendations array, score display, non-product-specific stats

### Source B: Time-series tables + inventory snapshots
- `bol_campaign_performance` / `bol_keyword_performance` — real metrics from Advertising API
- `bol_raw_snapshots` where `data_type='inventory'` — real product data incl. FBB titles + prices
- **Use for:** Any stat tile you want to be accurate (spend, ROAS, CTR, title quality, price coverage)

### Rule of thumb
> **Never use `analysis.findings` to display stat tiles**. Always compute from the already-fetched `products` or `campData.campaigns` arrays using `useMemo`.

Example pattern (correct):
```typescript
const campMetrics = useMemo(() => {
  const cs = campData?.campaigns ?? [];
  const spend = cs.reduce((s, c) => s + (c.spend ?? 0), 0);
  // ...
}, [campData]);
```

---

## Established Patterns

### Pagination (use this exact pattern everywhere)
```typescript
const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
const [page, setPage] = useState(0);
useEffect(() => { setPage(0); }, [search, sortKey, sortDir, pageSize]); // reset on filter change
const totalPages = Math.ceil(sorted.length / pageSize);
const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);
```

### Stats from arrays (use `useMemo`, never `analysis.findings`)
See `ProductsSection` → `titleStats`, `priceStats` and `CampaignSection` → `campMetrics`

### Chart data
Use `api/bol-campaigns-chart.ts` → `getBolCampaignChart(customerId, days)` → returns `{ points: BolCampaignChartPoint[] }`

### Supabase admin (API routes)
Always use `createAdminClient()` from `api/_lib/supabase-admin.ts` (not the anon client)

### Bol.com API client
Use `getBolApiClient(customer)` from `api/_lib/bol-api-client.ts` — handles token refresh automatically

---

## Known Gotchas

1. **`vercel dev` required** — `vite dev` doesn't run the `/api/` routes
2. **Amazon tokens are module-level cached** — refreshes happen per Vercel function instance, not per request
3. **Bol.com export = 2 steps** — initiate job (get `processStatusId`) → poll until done → download CSV. Implemented in `bol-sync-start.ts` + `bol-sync-complete.ts`
4. **`bol_campaigns.ts` deduplicates** — only returns latest row per campaign. Use `bol-campaigns-chart.ts` for historical/time-series data
5. **FBB sellers have no title in CSV** — titles only come from inventory snapshot or catalog API, not the listings export
6. **`analysis.findings`** is a JSONB blob with unpredictable schema — always access with optional chaining and fallbacks
7. **recharts** is installed (added for campaign chart) — use `AreaChart`, `Area`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`, `CartesianGrid`
8. **TypeScript strict** — run `npm run typecheck` after every change

---

## Environment Variables

```bash
# Supabase (frontend)
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

# Supabase (API routes - server only)
SUPABASE_URL
SUPABASE_SERVICE_KEY

# Anthropic
ANTHROPIC_API_KEY

# Amazon Ads OAuth2
AMAZON_CLIENT_ID
AMAZON_CLIENT_SECRET
AMAZON_REFRESH_TOKEN

# n8n webhook for proposal execution
N8N_PROPOSAL_WEBHOOK_URL
```

---

## Verification Checklist (after any change)

```bash
npm run typecheck   # must pass with 0 errors
vercel dev          # smoke test in browser
```
