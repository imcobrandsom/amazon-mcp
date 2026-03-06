# Phase 1: Content Intelligence Foundation — Deployment Guide

This document outlines the deployment steps for Phase 1 of the autonomous Bol.com content optimization agent.

## 📦 What's Included in Phase 1

### Database Schema
- **`bol_product_keyword_targets`** — Target keywords per product with priority, search volume, and rank tracking
- **`bol_category_attribute_requirements`** — Per-category completeness rules (required/recommended attributes)
- **`bol_customer_settings`** — Autonomy level configuration per customer
- **`get_product_completeness()`** function — Real-time completeness scoring
- **`bol_product_priority_queue`** view — Autonomous agent work queue

### API Endpoints
- **`GET /api/bol-product-analysis`** — Deep-dive analysis per product (completeness + keywords + competitor)
- **`POST /api/bol-keyword-sync`** — Sync keyword volumes, ranks, and content presence flags

### Frontend
- **Completeness column** in Products table with visual progress bars
- **Helper component**: `CompletenessBadge` — fetches and displays per-product completeness score
- **API wrappers** in `src/lib/bol-api.ts` for new endpoints

### Seed Data
- **FashionPower category requirements** — 5 pre-configured categories (sportkleding, sportlegging, sportshirts, sport-bhs, sportbroeken)

---

## 🚀 Deployment Steps

### 1. Run Database Migration

```bash
# Connect to Supabase SQL Editor
# Paste and run: supabase/migrations/016_bol_content_intelligence.sql
```

**Expected result:**
- 3 new tables created
- 1 function created
- 1 view created
- Default settings inserted for existing customers

**Verify:**
```sql
SELECT COUNT(*) FROM bol_customer_settings;  -- Should match number of bol_customers
SELECT * FROM bol_product_priority_queue LIMIT 5;  -- Should return empty (no keywords yet)
```

---

### 2. Seed Category Requirements

```bash
# In Supabase SQL Editor
# Paste and run: supabase/seeds/fashionpower_category_requirements.sql
```

**Expected result:**
```
NOTICE:  FashionPower customer ID: a260ef86-9e3a-47cf-9e59-68bf8418e6d8
NOTICE:  Successfully seeded 5 category requirements for FashionPower
```

**Verify:**
```sql
SELECT category_slug, category_name, array_length(required_attributes, 1) AS req_count
FROM bol_category_attribute_requirements
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
```

Expected output:
| category_slug | category_name | req_count |
|---------------|---------------|-----------|
| sportkleding | Sportkleding | 5 |
| sportlegging | Sportlegging | 6 |
| sportshirts-tops | Sportshirts & Tops | 5 |
| sport-bhs | Sport BH's | 5 |
| sportbroeken-shorts | Sportbroeken & Shorts | 5 |

---

### 3. Deploy Frontend & API

```bash
# From project root
npm run typecheck  # Must pass with 0 errors

# Deploy to Vercel
vercel --prod

# OR for local testing
vercel dev
```

**Verify deployment:**
1. Navigate to `/dashboard/bol/{customerId}`
2. Products table should now have a **"Complete"** column
3. Completeness badges should load (may show `...` initially as they fetch)

---

### 4. Initial Keyword Population

**Option A: Auto-Populate from Advertising Campaigns (Recommended)** ✅

This is the fastest way to get keywords for products that are already advertised.

```bash
# Via API
curl -X POST https://your-domain.vercel.app/api/bol-keywords-populate \
  -H "Content-Type: application/json" \
  -d '{"customerId": "a260ef86-9e3a-47cf-9e59-68bf8418e6d8"}'
```

**Expected result:**
```json
{
  "message": "Keywords populated from advertising campaigns",
  "campaigns_processed": 12,
  "ad_groups_processed": 45,
  "keywords_found": 237,
  "keyword_product_mappings": 1840,
  "unique_keywords_inserted": 1756,
  "note": "Run /api/bol-keyword-sync to fetch search volumes and update content presence flags"
}
```

**What this does:**
1. Fetches all active campaigns from Bol Advertising API
2. For each campaign → fetches ad groups
3. For each ad group → fetches keywords + product targets (EANs)
4. Maps keywords to products (many-to-many relationship)
5. Sets priority based on keyword bid (higher bid = higher priority)
6. Inserts into `bol_product_keyword_targets` (duplicates skipped automatically)

**Verify:**
```sql
SELECT
  COUNT(DISTINCT ean) AS products_with_keywords,
  COUNT(*) AS total_keyword_mappings,
  AVG(priority) AS avg_priority
FROM bol_product_keyword_targets
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
```

---

**Option B: Manual SQL (Quick Test)**

For testing or adding keywords to specific products:

```sql
-- Example: Add 3 test keywords for one product
INSERT INTO bol_product_keyword_targets (
  bol_customer_id,
  ean,
  keyword,
  priority,
  source,
  search_volume
) VALUES
  ('a260ef86-9e3a-47cf-9e59-68bf8418e6d8', '8720207906217', 'sportlegging dames', 9, 'manual', 12000),
  ('a260ef86-9e3a-47cf-9e59-68bf8418e6d8', '8720207906217', 'high waist legging', 8, 'manual', 8500),
  ('a260ef86-9e3a-47cf-9e59-68bf8418e6d8', '8720207906217', 'yoga broek', 7, 'manual', 5000);
```

---

### 5. Run Keyword Sync

```bash
# Via API (requires auth token)
curl -X POST https://your-domain.vercel.app/api/bol-keyword-sync \
  -H "Content-Type: application/json" \
  -d '{"customerId": "a260ef86-9e3a-47cf-9e59-68bf8418e6d8"}'
```

**Or via dashboard (future feature):**
Settings → Sync Keywords button

**Expected result:**
```json
{
  "message": "Keyword sync completed",
  "total": 150,
  "updated": 147,
  "errors": 3
}
```

**Verify:**
```sql
SELECT
  keyword,
  search_volume,
  current_organic_rank,
  in_title,
  in_description
FROM bol_product_keyword_targets
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY priority DESC
LIMIT 10;
```

Keywords should now have `search_volume`, `in_title`, and `in_description` populated.

---

### 6. Test Completeness Scoring

```bash
# Test the completeness function for a single product
SELECT * FROM get_product_completeness(
  'a260ef86-9e3a-47cf-9e59-68bf8418e6d8',  -- customer ID
  '8720207906217'  -- example EAN
);
```

**Expected output:**
| ean | category_slug | required_filled | required_total | required_completeness_pct | overall_completeness_score |
|-----|---------------|-----------------|----------------|---------------------------|----------------------------|
| 8720207906217 | sportlegging | 5 | 6 | 83 | 83 |

---

### 7. Test Priority Queue

```sql
SELECT
  ean,
  title,
  completeness_score,
  top_missing_keyword_volume,
  high_priority_keywords_missing,
  priority_score,
  action_reasons
FROM bol_product_priority_queue
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
ORDER BY priority_score DESC
LIMIT 10;
```

**Expected output:**
Products ranked by priority score with action reasons like:
- `{"Low completeness", "3 keywords missing", "High-volume keyword (12000/mo)"}`

---

## ✅ Verification Checklist

- [ ] Migration ran successfully (3 tables + 1 function + 1 view created)
- [ ] Seed data inserted (5 categories for FashionPower)
- [ ] Frontend deployed (Completeness column visible in products table)
- [ ] Keywords populated (manual or from ads data)
- [ ] Keyword sync ran successfully (search volumes updated)
- [ ] Completeness function returns scores for test products
- [ ] Priority queue view returns ranked products
- [ ] No TypeScript errors (`npm run typecheck` passes)

---

## 🐛 Troubleshooting

### Issue: Completeness badges show "—" (null)

**Cause:** Product's category not in `bol_product_categories` table, or no category requirements configured.

**Fix:**
1. Check if product has category mapping:
   ```sql
   SELECT * FROM bol_product_categories WHERE ean = 'YOUR_EAN';
   ```
2. If missing, run extended sync to populate categories
3. If category exists but no requirements, add category to seed data

---

### Issue: Keyword sync fails with API errors

**Cause:** Bol.com API rate limits or invalid credentials.

**Fix:**
1. Check customer credentials are valid:
   ```sql
   SELECT bol_client_id FROM bol_customers WHERE id = 'YOUR_CUSTOMER_ID';
   ```
2. Reduce batch size in `bol-keyword-sync.ts` (currently 1 keyword per 250ms)
3. Check Bol API logs for specific error messages

---

### Issue: Priority queue is empty

**Cause:** No keywords populated yet, or all products have >80% completeness.

**Fix:**
1. Populate keywords (see step 4)
2. Lower completeness threshold in view:
   ```sql
   -- Edit view WHERE clause:
   WHERE pc.completeness_score < 90  -- was 80
   ```

---

## 📊 Next Steps (Phase 2)

Once Phase 1 is verified:
1. **AI Content Generator** — Auto-generate optimized titles/descriptions
2. **Product Detail Modal** — Deep-dive UI per product
3. **Keyword Intelligence** — Auto-populate keywords from category insights
4. **Performance Tracking** — Measure ranking improvements after content updates

See `PHASE2_IMPLEMENTATION.md` (coming soon) for details.

---

## 📞 Support

Questions? Check:
- **CLAUDE.md** — Project structure and patterns
- **Supabase logs** — Database errors
- **Vercel logs** — API endpoint errors
- **Browser console** — Frontend errors

**Common issues documented in MEMORY.md**
