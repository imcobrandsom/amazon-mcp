# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Follo Marketplace AI Platform

Developer guide for Claude Code sessions. Read this before making changes.

---

## Project Overview

Internal tool for Follo agency to manage **Amazon Advertising** (via Claude AI + MCP) and a **Bol.com seller dashboard** with sync, analytics, and AI-generated recommendations.

**Stack:** React 18 + TypeScript + Tailwind (Vite) → Vercel · Supabase (Postgres + Auth + RLS) · Claude claude-sonnet-4-5 · Vercel serverless API routes

---

## Development Commands

```bash
# Local development (MUST use vercel dev, not vite dev)
vercel dev              # Runs Vite dev server + API routes at localhost:3000

# Type checking
npm run typecheck       # Must pass with 0 errors before committing

# Build
npm run build           # Compiles TypeScript + bundles frontend

# Preview production build
npm run preview
```

**IMPORTANT:** Always use `vercel dev` for local development, NOT `vite dev`. The `/api/` routes are Vercel serverless functions and require the Vercel CLI to run locally.

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
| **Phase 1 & 2 - Autonomous Content Agent** | |
| `bol-product-analysis.ts` | Deep product analysis (completeness + keywords + competitor) |
| `bol-keywords-enrich.ts` | **Comprehensive keyword enrichment**: AI content extraction + advertising mapping + search volume + category fallbacks + metadata sync (called by main sync) |
| `bol-keywords-ai-cron.ts` | **AI keyword extraction cron** (every 15min): processes products with AI keyword extraction |
| `bol-keyword-sync.ts` | Sync keyword metadata (in_title, in_description flags) |
| `bol-keywords-populate.ts` | DEPRECATED: Use bol-keywords-enrich instead |
| `bol-keywords-fallback.ts` | DEPRECATED: Integrated into bol-keywords-enrich |
| `bol-keywords-competitor-extract.ts` | DEPRECATED: Integrated into bol-keywords-enrich (AI competitor analysis) |
| `bol-keyword-sync-cron.ts` | Daily cron job to sync keyword metadata (03:00 UTC) |
| `bol-sync-categories.ts` | Sync product categories (02:30 UTC daily) |
| `bol-content-generate.ts` | AI content generation using Claude Sonnet 4.5 |
| `bol-content-approve.ts` | Approve content proposal workflow |
| `bol-content-reject.ts` | Reject content proposal workflow |
| `bol-content-push.ts` | Push approved content to Bol.com + create performance snapshot |
| `bol-content-upload.ts` | Upload client content basis (Excel/CSV with original product descriptions) |
| **Amazon Ads** | |
| `amazon-connect.ts` | Amazon Ads LwA OAuth2 flow |
| `amazon-callback.ts` | Amazon OAuth callback; stores refresh token |
| `token-refresh.ts` | Amazon access token refresh (module-level cache) |
| `proposal.ts` | Approve/reject/execute proposals; fires n8n webhook |
| `conversation-summary.ts` | Auto-summary when user leaves chat |

### API helpers (`/api/_lib/`)

**IMPORTANT**: Function timeout overrides are configured in `vercel.json`. Long-running sync operations have 300s (5min) timeouts. Default is 10s.

| File | Purpose |
|---|---|
| `supabase-admin.ts` | Supabase admin client (service role) for server-side access |
| `amazon-token.ts` | Amazon OAuth2 token caching (~15 min, module-level) |
| `bol-api-client.ts` | Full Bol.com Retailer + Advertising API client (auth, exports, CSV parsing) |
| `bol-analysis.ts` | AI scoring engine: analyzes content, inventory, orders, ads, returns, performance |
| `bol-content-prompts.ts` | AI prompt engineering for Dutch SEO content optimization |

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
│       ├── BolSection.tsx
│       ├── ContentSection.tsx
│       └── ProductDetailModal.tsx  ← Phase 2 modal (Overview/Keywords/Content/Performance tabs)
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

### Bol.com (Core)
- **`bol_customers`** — seller accounts with Retailer + Advertising API credentials
- **`bol_sync_jobs`** — async export job tracking (2-step pattern)
- **`bol_raw_snapshots`** — raw API responses as JSONB (audit trail, data_type = listings/inventory/orders/etc.)
- **`bol_analyses`** — AI analysis results: `score` (0-100) + `findings` (JSONB) + `recommendations` array
- **`bol_campaign_performance`** — **time-series**: one row per campaign per sync run
- **`bol_keyword_performance`** — **time-series**: one row per keyword per sync run
- **`bol_competitor_snapshots`** — per-EAN competing offers with prices + buy box
- **`bol_keyword_rankings`** — per-EAN search/browse rank history
- **`bol_product_categories`** — per-EAN category mapping (category_slug + category_name)

### Bol.com (Phase 1 - Content Intelligence)
- **`bol_product_keyword_targets`** — keyword-product mappings with priority, search volume, rank tracking
- **`bol_category_attribute_requirements`** — per-category completeness rules (required/recommended attributes)
- **`bol_customer_settings`** — autonomy level configuration (manual/semi-auto/auto)
- **`bol_product_priority_queue`** — VIEW: products ranked by business impact + keyword opportunity

### Bol.com (Phase 2 - Content Generation)
- **`bol_content_proposals`** — AI-generated content proposals (pending/approved/pushed/rejected)
- **`bol_content_performance_snapshots`** — before/after performance tracking (7d/14d/30d intervals)
- **`bol_content_performance_summary`** — VIEW: aggregated impact metrics per proposal

---

## Architecture Patterns

### API Routes → Vercel Serverless Functions
All files in `/api/*.ts` are deployed as separate Vercel serverless functions. Each has:
- Independent Node.js runtime instance
- Module-level state (used for token caching)
- Default 10s timeout (can be overridden in `vercel.json`)
- No shared memory between function invocations

### Frontend Data Flow
```
User action in React component
  ↓
Call function from src/lib/bol-api.ts
  ↓
Fetch POST/GET to /api/bol-*.ts endpoint
  ↓
API route uses createAdminClient() from api/_lib/supabase-admin.ts
  ↓
Query Supabase tables with service role key
  ↓
Return JSON to frontend
  ↓
React component updates state
```

### Bol.com 2-Step Export Pattern
Bol.com API exports are async jobs. All sync operations follow this pattern:
1. **Initiate** (`POST /retailer/export/jobs`) → get `processStatusId`
2. **Poll** (`GET /retailer/export/jobs/{id}`) until `state: 'COMPLETED'`
3. **Download** CSV from the `url` in the response
4. **Parse** CSV → store in `bol_raw_snapshots` + derived tables

Implemented in:
- `api/bol-sync-start.ts` — initiates jobs, stores in `bol_sync_jobs` table
- `api/bol-sync-complete.ts` — polls pending jobs, downloads + parses CSVs

### Authentication Layers
- **Frontend**: Supabase anon key + RLS (via `src/lib/supabase.ts`)
- **API routes**: Supabase service role key + manual auth checks (via `api/_lib/supabase-admin.ts`)
- **Amazon Ads**: OAuth2 refresh token → module-level cached access token (~15min TTL)
- **Bol.com**: Per-customer client ID/secret → module-level cached access token (stored in customer record)

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

## Autonomous Content Optimization (Phase 1-2)

### 5-Source Keyword Enrichment Strategy (Phase 2)

**NEW:** All keyword enrichment is now handled by `/api/bol-keywords-enrich` which combines 5 keyword sources:

1. **AI Content Extraction** (priority varies) — Claude analyzes current product content (title + description) and extracts both existing keywords AND suggests missing keywords based on:
   - Product category and attributes
   - Client-uploaded content basis (original product descriptions from `bol_content_basis`)
   - Dutch SEO best practices for Bol.com
   - Material, use cases, and product features

2. **Advertising API Keywords** (priority 8-10) — Maps keywords from active Bol Advertising campaigns to products via ad group product targets
   - Priority calculated from bid amount (higher bid = higher priority)

3. **Search Volume Intelligence** — Enriches keywords with search volume data from Bol.com Search Terms API (`/retailer/insights/search-terms`)
   - Fetches volume for top 50 keywords per sync
   - Stored in `search_volume` column

4. **Category-Based Fallback** (priority 5-7) — Products without advertising keywords get category-specific keywords from `CATEGORY_KEYWORDS` mapping
   - Examples: sportlegging, sport-bhs, sportshirts-tops, sportbroeken-shorts
   - Generic "sportkleding" fallback for uncategorized products

5. **Competitor Keyword Analysis** (priority varies) — AI analyzes competitor titles/descriptions to extract high-value keywords
   - Integrated into enrichment endpoint (runs every 6h via competitor sync cron)

**Keyword Enrichment Process** (runs during main sync):
- Called automatically after inventory + advertising data fetch
- Processes up to 50 products with AI content analysis (rate-limited 1 req/2s)
- Maps all advertising keywords to products via ad groups
- Adds category fallbacks for products without keywords
- Fetches search volumes for top keywords
- Syncs metadata (in_title, in_description flags)
- **Input Content:** Uses both current Bol.com content AND client-uploaded content basis as reference (AI does NOT invent facts not present in either)

### Content Intelligence Tables

- **`bol_product_keyword_targets`** — target keywords per EAN with priority, source, search_volume, in_title/in_description flags
  - Sources: `ai_suggestion`, `content_analysis`, `advertising`, `category_analysis`, `competitor_analysis`
- **`bol_content_basis`** — client-uploaded original product content (Excel/CSV) used as reference by AI
  - Uploaded via Content tab → Upload button → processed by `/api/bol-content-upload`
- **`bol_client_brief`** — per-customer brand guidelines and content rules for AI generation
- **`bol_content_scores`** — per-EAN quality scores (title, description, images, attributes)
- **`bol_content_gaps`** — identified gaps with priority and recommended actions
- **`bol_category_attribute_requirements`** — per-category quality rules (required/recommended attributes, scoring weights)

### Priority Queue Logic

Products are ranked by **business impact × keyword opportunity**:

```typescript
score = (clicks × 2 + spend) × (total_keywords - keywords_in_content)
```

High-traffic products with missing keywords rank highest. Dashboard shows top 5 in dedicated tile (Phase 1.5).

### Content Prompt Templates (AI Generator - Phase 2)

Stored in `api/_lib/bol-content-prompts.ts`:
- `generateTitlePrompt` — SEO-optimized titles (50-150 chars)
- `generateDescriptionPrompt` — feature-rich descriptions (250-2000 chars)
- `generateBulletPointsPrompt` — 3-5 key selling points
- `generateAttributePrompt` — extract structured attributes from text

All prompts include:
- Category-specific requirements from `bol_category_attribute_requirements`
- Competitor intel (buy box winners, common patterns)
- Keyword integration rules (primary keyword in title + 3-5 secondary keywords naturally distributed)
- Bol.com SEO best practices (no ALL CAPS, avoid emoji, brand + product type + key feature structure)

### Phase 1.5 Quick Wins (Deployed)

- **Priority Queue tile** — Top 5 products by optimization potential (business impact × keyword gaps)
- **Enhanced completeness badges** — Gradient styling + tooltips showing exact scores
- **Quick filters** — Stock filter (all/low stock/out of stock), advertising filter (all/advertised/not advertised)
- **Daily keyword metadata sync** — Automated cron job at 03:00 UTC updating in_title/in_description flags

### Phase 2.5: Skills Architecture + Prompt Versioning (NEW)

Content generation uses a **skill-based architecture** with **database-driven prompt versioning** for continuous improvement.

**Skill Invocation Flow:**
```
UI "Genereer" button
  ↓
generateBolContent(customerId, ean, 'manual')  [src/lib/bol-api.ts]
  ↓
POST /api/skill-invoke { skillName: 'bol_content_generate', input: {...} }
  ↓
executeBolContentGenerate()  [api/_lib/skills/bol-content-generate.ts]
  ├─ Fetches active prompt version from database (get_active_prompt_version RPC)
  ├─ Builds prompt using database template + context data
  ├─ Calls Claude Sonnet 4.5
  ├─ Saves proposal with prompt_version_id tracking
  └─ Updates performance metrics (avg title/desc length, keywords added)
  ↓
Returns proposal → UI drawer modal
```

**Prompt Versioning System:**

Database-driven prompts allow rapid iteration without code deployment:

- **Database**: `bol_content_prompt_versions` table (migration 025)
- **Multiple versions** per customer with version numbers
- **One active version** at a time (or A/B test with 2 versions)
- **Performance tracking**: total generations, avg title/desc length, keywords added
- **Admin UI**: Visual prompt editor at `/bol/:customerId/prompts`

**Key Features:**
- ✅ Create new prompt versions via UI or API
- ✅ Edit system instructions, title/description rules
- ✅ Test prompts with real products before activation
- ✅ Compare performance metrics across versions
- ✅ A/B testing support (random 50/50 split)
- ✅ Easy rollback to previous versions
- ✅ Track which version generated each proposal

**Database Functions:**
- `get_active_prompt_version(customer_id)` — Returns active version (or random A/B)
- `activate_prompt_version(version_id)` — Activates version, deactivates others
- `update_prompt_performance(...)` — Updates metrics after generation

**API Endpoints:**
- `GET/POST /api/bol-prompt-versions` — List/create versions
- `PUT /api/bol-prompt-versions` — Update version
- `DELETE /api/bol-prompt-versions` — Delete version (only if not active)
- `POST /api/bol-prompt-activate` — Activate version

**Improvement Workflow:**
1. Go to Prompt Editor (via "Prompt Editor" button in Content tab)
2. Create new version with improved instructions
3. Test with sample product (enter EAN, click "Test")
4. Compare metrics with current version
5. Activate new version if better
6. Performance tracked automatically on all future generations

**Available Skills:**
- `bol_content_generate` — Generate SEO-optimized Dutch content for Bol.com products
  - Input: `customer_id`, `ean`, `trigger_reason` ('manual' | 'quality_score' | 'keyword_trend')
  - Output: `{ success, proposal, reasoning, estimated_improvement_pct }`
  - Invocation: `POST /api/skill-invoke` with `{ skillName, input }`
  - Uses database prompt version (falls back to hardcoded if none exists)

**Shared Logic:**
- `api/_lib/bol-content-helpers.ts` — Reusable data fetching and proposal saving
  - `fetchContentGenerationContext()` — Fetches product, keywords, category, brief, competitors
  - `saveContentProposal()` — Inserts proposal with prompt_version_id tracking
- `api/_lib/bol-content-prompts.ts` — Original hardcoded prompts (fallback only)
  - `buildContentOptimizationPrompt()` — Dutch SEO prompt construction
  - `parseClaudeResponse()` — JSON extraction and validation
  - `calculateChangesSummary()` — Keyword diff analysis
- `api/_lib/bol-content-prompt-builder.ts` — **NEW**: Database prompt builder
  - `getActivePromptVersion()` — Fetches active version from database
  - `buildDatabasePrompt()` — Builds prompt using version template
  - `updatePromptPerformance()` — Updates metrics after generation

**Adding New Skills:**
1. Create skill handler in `/api/_lib/skills/{skill-name}.ts` with `execute{SkillName}()` function
2. Add case to `/api/skill-invoke.ts` switch statement
3. Add frontend wrapper in `/src/lib/bol-api.ts` (if needed)
4. Update CLAUDE.md with usage examples

Time per skill: ~1-2 hours (copy-paste pattern established).

### Sync Process Workflow

**Main Sync** (`POST /api/bol-sync-trigger` with `syncType: 'main'`):
1. Fetches inventory + listings + orders from Bol.com Retailer API (2-step async pattern)
2. Fetches advertising campaigns + keywords from Bol.com Advertising API (if credentials set)
3. **Keyword Enrichment** (Phase 2 - calls `/api/bol-keywords-enrich`):
   - AI content-based keyword extraction (current + basis content)
   - Advertising keyword mapping to products
   - Search volume data from Search Terms API
   - Category-based fallbacks for products without ads
   - Metadata sync (in_title, in_description flags)
4. Runs AI analysis on fetched data → stores in `bol_analyses`

**Complete Sync** (adds to Main):
- Product categories
- Product attributes
- Full competitor analysis per EAN

**Extended Sync** (adds to Complete):
- Keyword ranking history
- Catalog enrichment from search results

**Cron Jobs** (configured in `vercel.json`):
- `02:00 UTC daily` — Main sync for all active customers (`bol-sync-start`)
- `02:30 UTC daily` — Product category sync (`bol-sync-categories`)
- `03:00 UTC daily` — Keyword metadata sync (`bol-keyword-sync-cron`)
- `07:00 UTC Monday` — Weekly keyword rankings update (`bol-sync-keywords`)
- `Every 5min` — Complete pending sync jobs (`bol-sync-complete`)
- `Every 6h` — Extended sync (`bol-sync-extended`)
- `Every 6h +30min` — Competitor analysis (`bol-sync-competitor-analysis`)
- `Every 15min` — AI keyword extraction (`bol-keywords-ai-cron`)

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

## Testing & Debugging

### Test API Endpoints
The codebase includes test endpoints (prefixed with `test-*.ts`) for debugging specific features:
- Call these via `POST http://localhost:3000/api/test-*` during development
- These are NOT production endpoints and should not be deployed if possible
- Examples: `test-sync.ts`, `test-content-tables.ts`, `test-competitor-sync.ts`

### Debugging Sync Issues
1. Check `bol_sync_jobs` table for job status and error messages
2. Check `bol_raw_snapshots` to verify data was fetched and stored
3. Use `vercel logs` command to view serverless function logs in production
4. Look at `fetched_at` timestamps to verify freshness of data

### Common Debugging Patterns
```typescript
// Always log at the start of API routes
console.log('[bol-sync-start] Starting sync for customer:', customerId);

// Log before/after counts for data operations
const { count: before } = await supabase.from('table').select('*', { count: 'exact', head: true });
// ... insert/update operations
const { count: after } = await supabase.from('table').select('*', { count: 'exact', head: true });
console.log(`Inserted ${after - before} rows`);
```

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
9. **Keyword enrichment (Phase 2)** — Main sync automatically calls `/api/bol-keywords-enrich` which combines AI content extraction, advertising mapping, search volumes, category fallbacks, and metadata sync. Old populate/fallback endpoints are deprecated.
10. **Client content basis** — AI content generation uses BOTH current Bol.com content AND client-uploaded content from `bol_content_basis` table as reference. AI will NOT invent facts not present in either source.
11. **Priority queue score** — `(clicks × 2 + spend) × (total_keywords - keywords_in_content)` — higher = more impact + more opportunity
12. **Internal API calls** — When an API route needs to call another API route, use `req.headers.host` to construct the URL (NOT `process.env.VERCEL_URL`). Example: `const host = req.headers.host; await fetch(\`http://\${host}/api/other-endpoint\`)`

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

# Vercel Cron Jobs (Phase 1.5)
CRON_SECRET  # Bearer token for authenticating cron endpoints
```

---

## Deployment Checklist

### Phase 1 & 2 Setup (First Time)

1. **Run migrations** in Supabase SQL editor (run all in order, 24 total):
   ```sql
   -- Core migrations (001-013)
   -- Content intelligence (014-019)
   -- See supabase/migrations/ directory for complete list
   ```

2. **Seed category requirements** (FashionPower):
   ```sql
   supabase/seeds/fashionpower_category_requirements.sql
   ```

3. **Add environment variables** in Vercel:
   ```bash
   # Generate secure random string:
   openssl rand -base64 32

   # Add to Vercel:
   vercel env add CRON_SECRET production
   ```

4. **First sync**:
   - Go to dashboard → Sync button → "Main Sync"
   - This will auto-populate keywords from advertising campaigns
   - Fallback keywords will be added for non-advertised products
   - Keyword metadata will be synced immediately

5. **Verify cron jobs** in Vercel dashboard:
   - `bol-sync-start` (02:00 UTC daily)
   - `bol-sync-categories` (02:30 UTC daily)
   - `bol-keyword-sync-cron` (03:00 UTC daily)
   - `bol-sync-keywords` (07:00 UTC Monday)
   - `bol-sync-complete` (every 5min)
   - `bol-sync-extended` (every 6h)
   - `bol-sync-competitor-analysis` (every 6h +30min)
   - `bol-keywords-ai-cron` (every 15min)

### Every Deploy

```bash
npm run typecheck   # must pass with 0 errors
vercel dev          # smoke test in browser
git push origin main  # auto-deploys to Vercel
```
