# Phase 2: AI Content Generator + Intelligence Layer

## 🎯 Goals

Transform the foundation from Phase 1 into an **intelligent content optimization system** that:
1. Auto-generates optimized titles + descriptions based on keywords, category requirements, and competitor intel
2. Provides deep product analysis UI (Product Detail Modal)
3. Learns from category insights and competitor content
4. Tracks performance after content updates

---

## 📦 Deliverables

### 1. AI Content Generation Pipeline

**New API Endpoint:** `POST /api/bol-content-generate`

**Inputs:**
- Product EAN
- Customer ID
- Trigger reason (quality_score | keyword_trend | manual)

**Process:**
1. Fetch product completeness data
2. Fetch target keywords (top 10 by priority)
3. Fetch category requirements
4. Fetch competitor content (if available)
5. Fetch client brief (tone of voice)
6. Call Claude API with structured prompt
7. Generate optimized title + description (with USPs breakdown)
8. Calculate changes summary (keywords added/removed, char counts)
9. Save to `bol_content_proposals` table

**Output:**
- New proposal record with status='pending' (or 'approved' in auto mode)
- Changes summary JSON
- Estimated score improvement

---

### 2. Product Detail Modal (Frontend)

**Component:** `src/components/Bol/ProductDetailModal.tsx`

**Sections:**
- **Overview Card**
  - Product image placeholder
  - Current title + description
  - Completeness score breakdown (required/recommended attributes)
  - Category + fulfilment type

- **Keywords Tab**
  - Target keywords list with:
    - Priority badge (1-10)
    - Search volume
    - Current rank (if available)
    - In-title/in-description status (✓ or ✗)
    - Quick action: "Add to title" button
  - Total search volume impact
  - Missing high-priority keywords alert

- **Competitor Intel Tab** (if data available)
  - Side-by-side comparison: Your Product vs. Top Competitor
  - Price gap
  - Buy box status
  - Content quality comparison
  - Missing keywords that competitors use

- **Content History Tab**
  - List of proposals (pending, approved, rejected)
  - Timeline view
  - Before/after comparison

**Footer Actions:**
- "Generate Optimized Content" button (calls AI generator)
- "View in Bol.com" link (external)

---

### 3. AI Prompt Engineering

**Prompt Template:** `api/_lib/bol-content-prompts.ts`

**Structure:**
```typescript
export function buildContentOptimizationPrompt(context: {
  product: BolProduct;
  keywords: BolProductKeywordTarget[];
  categoryReqs: BolCategoryAttributeRequirements;
  clientBrief: string;
  competitor?: BolCompetitorCatalog;
}): string {
  // Multi-part prompt:
  // 1. System role: "Je bent een expert Bol.com content optimizer..."
  // 2. Context: Product details, category rules, keywords
  // 3. Constraints: Character limits, required attributes
  // 4. Task: Generate title + description with USPs
  // 5. Output format: JSON with title, description parts, keywords used
}
```

**Key Considerations:**
- Dutch language optimization
- Bol.com best practices (no emoji, no ALL CAPS, keyword density)
- SEO-friendly structure
- Client tone of voice adherence
- Keyword placement strategy (high-priority keywords in title)

---

### 4. Content Proposal Workflow

**New API Endpoints:**

**`POST /api/bol-content-generate`** — Generate new proposal
- Calls Claude API
- Saves to `bol_content_proposals`
- Returns proposal ID

**`POST /api/bol-content-approve`** — Approve proposal
- Updates status to 'approved'
- If autonomy_level='auto': triggers push to Bol API

**`POST /api/bol-content-reject`** — Reject proposal
- Updates status to 'rejected'
- Logs rejection reason (optional)

**`POST /api/bol-content-push`** — Push to Bol.com
- Uses Bol Retailer API to update product content
- Updates proposal status to 'pushed'
- Records `pushed_at` timestamp

---

### 5. Performance Tracking (Foundation)

**New Table:** `bol_content_performance_snapshots`

```sql
CREATE TABLE bol_content_performance_snapshots (
  id uuid PRIMARY KEY,
  bol_customer_id uuid REFERENCES bol_customers(id),
  proposal_id uuid REFERENCES bol_content_proposals(id),
  ean text NOT NULL,

  -- Snapshot timing
  snapshot_type text CHECK (snapshot_type IN ('before', 'after_7d', 'after_14d', 'after_30d')),
  snapshot_date date NOT NULL,

  -- Metrics
  organic_rank_avg numeric,  -- Average rank across target keywords
  impressions integer,
  clicks integer,
  conversions integer,
  revenue numeric,

  -- Advertising performance (if product is advertised)
  ad_impressions integer,
  ad_clicks integer,
  ad_spend numeric,
  ad_revenue numeric,

  created_at timestamptz DEFAULT now(),

  UNIQUE(proposal_id, snapshot_type)
);
```

**Purpose:** Track metrics before/after content updates to measure impact.

**Automated snapshots:**
- `before`: Captured when proposal is pushed
- `after_7d`: 7 days after push
- `after_14d`: 14 days after push
- `after_30d`: 30 days after push

**Cron job:** Daily check for proposals needing snapshots.

---

### 6. Batch Content Generation (Autonomous Agent Core)

**New API Endpoint:** `POST /api/bol-content-auto-generate`

**Input:**
```json
{
  "customerId": "uuid",
  "batchSize": 10,
  "minPriorityScore": 500
}
```

**Process:**
1. Fetch top N products from `bol_product_priority_queue`
2. For each product:
   - Generate content proposal
   - Auto-approve if autonomy_level='auto' AND low-risk
   - Push to Bol if auto-approved
3. Return summary: generated, approved, pushed counts

**Low-risk criteria:**
- Only keyword additions (no removals)
- Title stays under max length
- ≤3 keywords added
- No description rewrites (only USP additions)

---

## 🗂️ File Structure

```
api/
├── bol-content-generate.ts          ← Generate single proposal
├── bol-content-approve.ts           ← Approve proposal
├── bol-content-reject.ts            ← Reject proposal
├── bol-content-push.ts              ← Push to Bol API
├── bol-content-auto-generate.ts     ← Batch generation (autonomous)
└── _lib/
    └── bol-content-prompts.ts       ← Prompt templates

src/
├── components/
│   └── Bol/
│       ├── ProductDetailModal.tsx   ← Deep-dive modal
│       ├── ContentProposalCard.tsx  ← Proposal display
│       └── KeywordListItem.tsx      ← Keyword row component
├── lib/
│   └── bol-api.ts                   ← Add new API wrappers
└── types/
    └── bol.ts                       ← Extend existing types

supabase/
└── migrations/
    └── 017_bol_content_performance_tracking.sql
```

---

## 🔄 User Flow Examples

### Manual Mode (Current Default)

1. User opens Products table
2. Clicks on low-completeness product (e.g., 45%)
3. Product Detail Modal opens
4. Sees missing keywords: "hardloop legging" (12k volume), "sport broek" (8k volume)
5. Clicks "Generate Optimized Content"
6. AI generates proposal in ~3 seconds
7. User reviews: Title improved, 3 keywords added, description has USPs
8. User clicks "Approve"
9. User clicks "Push to Bol.com"
10. Content goes live on Bol.com

### Semi-Auto Mode

1-8. Same as manual
9. System auto-pushes (low-risk change detected)
10. User gets notification: "Content updated for 1 product"

### Fully Autonomous Mode

1. Cron job runs daily (scheduled)
2. Fetches priority queue (top 20 products)
3. Generates proposals for all
4. Auto-approves low-risk changes
5. Auto-pushes to Bol API
6. User sees summary in dashboard: "10 products optimized today"

---

## 🧪 Testing Strategy

### Unit Tests (Optional for MVP)
- Prompt generation logic
- Changes summary calculation
- Low-risk change detection

### Integration Tests
1. Generate proposal for test product
2. Verify proposal saved in DB
3. Approve + push workflow
4. Verify Bol API called correctly

### Manual Testing Checklist
- [ ] Product detail modal opens for any product
- [ ] Keywords display with correct priority/volume
- [ ] Generate button calls API and returns proposal
- [ ] Approve/Reject buttons work
- [ ] Push to Bol updates content (verify on bol.com)
- [ ] Completeness score increases after push
- [ ] Performance snapshot captured

---

## 📊 Success Metrics

**Immediate (Phase 2 launch):**
- ✅ Generate proposal for 1 product successfully
- ✅ Push to Bol.com successfully
- ✅ Completeness score increases by ≥10%

**Week 1 (Manual mode):**
- 50 proposals generated
- 30 approved + pushed
- Average completeness increase: 15%

**Week 2 (Semi-auto enabled):**
- 100 proposals generated
- 70 auto-approved
- 60 auto-pushed
- User override rate: <10%

**Month 1 (Full autonomous for select customers):**
- 500+ proposals generated
- 400+ auto-pushed
- Measurable ranking improvements
- ≥5% revenue increase for optimized products

---

## ⏱️ Implementation Timeline

**Day 1-2: Content Generation Core**
- Migration 017 (performance tracking table)
- Prompt engineering + API endpoint
- Test with Claude API

**Day 3: Product Detail Modal**
- Build modal UI
- Keywords tab
- Completeness breakdown

**Day 4: Approval Workflow**
- Approve/Reject endpoints
- Push to Bol API integration
- Error handling

**Day 5: Batch Generation**
- Auto-generate endpoint
- Autonomous mode logic
- Testing + deployment

**Total: ~5 development days (1 week)**

---

## 🚧 Known Challenges & Solutions

### Challenge 1: Bol API Rate Limits
**Solution:** Queue system for bulk updates (max 10/minute)

### Challenge 2: Content Quality Verification
**Solution:** Human review for first 20 proposals, then enable auto-approve

### Challenge 3: Keyword Cannibalization
**Solution:** Check if keyword already used in other products, warn user

### Challenge 4: Bol API Errors (503, timeouts)
**Solution:** Retry logic (3x exponential backoff), mark proposal as 'push_failed'

---

## 📝 Next Steps After Phase 2

**Phase 3: Advanced Intelligence**
- Competitor content scraping (real-time)
- A/B testing (2 title variants per product)
- Category trend detection
- Auto-keyword discovery from search volume spikes

**Phase 4: Image Enrichment**
- n8n workflow integration
- Image quality scoring
- Auto-trigger enrichment for low-quality images

**Phase 5: Multi-Channel**
- Expand to Amazon NL
- Unified content generator (Bol + Amazon)
- Cross-platform keyword strategy

---

Ready to start Phase 2 implementation? 🚀
