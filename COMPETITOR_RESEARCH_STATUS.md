# Bol.com Competitor Research - Status Update

**Date:** March 3, 2026
**Status:** ✅ Infrastructure Complete | ⚠️ Fundamental API Limitation Discovered

---

## Current State

### ✅ What's Working (100%)

1. **Database Schema** - All 4 tables created and deployed
   - `bol_product_categories` (50 products across 4 categories)
   - `bol_competitor_snapshots` (200 snapshots)
   - `bol_competitor_catalog` (ready)
   - `bol_competitor_content_analysis` (ready)
   - `bol_category_insights` (ready)

2. **Category Extraction** - Fixed and working
   - Products now properly categorized into 4 real categories:
     - clothing
     - sport-lower-body-wear
     - sport-upper-body-wear
     - upper-body-wear-tops

3. **API Endpoints** - All working with proper Vercel types
   - `GET /api/bol-category-insights`
   - `GET /api/bol-competitor-catalog`
   - `POST /api/bol-sync-competitor-analysis`

4. **Frontend** - Complete UI ready
   - Route: `/clients/:clientId/bol-competitor-research`
   - Category selector, stat tiles, tables, filters, pagination

---

## ⚠️ Critical Discovery: API Limitation

### The Problem

The Bol.com Retailer API **does not provide a way to discover other products in a category**.

**What we have:**
- `bol_competitor_snapshots` table with 200 rows
- Each row represents ONE of YOUR products (identified by EAN)
- The `competitor_prices` JSONB contains **competing offers from other sellers for THE SAME product**
- This is "same product, different seller" competition (price competition, buy box battles)

**What you wanted:**
> "For 50 of YOUR products in 'Sportlegging' category → aggregate all competing EANs → rank by frequency → analyze top 100 most frequent competitors"

This requires finding OTHER PRODUCTS in the same category ("different products, same category" competition) - which the API doesn't support.

### Why Product Discovery Fails

1. **Catalog API** returns `gpc.chunkId` (Bol.com's internal category ID)
2. **Product Discovery API** (`/retailer/content/products`) doesn't accept `gpc.chunkId` as a valid `categoryId`
3. No other endpoint in the Retailer API provides category-based product discovery
4. The API is designed for SELLERS to manage THEIR OWN products, not to browse competitors' catalogs

---

## Possible Solutions

### Option 1: Pivot to Seller Competition Analysis ✅ **Easiest**

**What it does:**
- Analyze the 200 products in `bol_competitor_snapshots`
- Show which SELLERS are competing with you on your products
- Metrics: price gaps, buy box win rates, seller frequency, condition distribution

**Example insights:**
- "Seller XYZ undercuts you on 15 products by an average of €3.50"
- "You win the buy box on 60% of your listings"
- "Competitor prices are 8% lower on average in the 'sport-lower-body-wear' category"

**Implementation:**
- Modify `processCategory()` to analyze `competitor_prices` JSONB (sellers, not EANs)
- Generate insights about seller competition, not product competition
- Update frontend to show seller-based metrics

**Pros:**
- ✅ Uses existing data (no API changes needed)
- ✅ Provides actionable pricing insights
- ✅ Fast to implement (2-3 hours)

**Cons:**
- ❌ Doesn't show "what other products exist in my category"
- ❌ Can't analyze competitor product quality/content

---

### Option 2: Manual Competitor Tracking 🔧 **Moderate Effort**

**What it does:**
- Add a UI to manually input competitor EANs you want to track
- Fetch catalog data for those EANs via `/retailer/content/catalog-products/{ean}`
- Run AI content analysis on those products
- Store in `bol_competitor_catalog` table

**Example workflow:**
1. User researches Bol.com marketplace manually (via website search)
2. Finds competitor products: `8712345678901`, `8798765432109`, etc.
3. Inputs EANs into dashboard
4. System fetches catalog data + runs AI analysis
5. Displays side-by-side comparison

**Pros:**
- ✅ Achieves original goal (competitor product analysis)
- ✅ Uses existing infrastructure (catalog API + AI analysis working)
- ✅ User controls what gets tracked

**Cons:**
- ❌ Manual discovery required (not automated)
- ❌ Needs new UI for EAN input/management
- ❌ Doesn't scale to "find top 100 competitors automatically"

**Implementation estimate:** 1-2 days

---

### Option 3: Hybrid Approach 💡 **Best of Both**

**Combine Options 1 + 2:**

**Phase A: Seller Competition (immediate value)**
- Deploy Option 1 to analyze existing seller competition data
- Show pricing insights, buy box stats, seller frequency

**Phase B: Manual Competitor Tracking (long-term)**
- Add EAN input UI for manual competitor tracking
- User finds competitor products via Bol.com search, inputs EANs
- System fetches catalog + runs AI analysis

**Pros:**
- ✅ Immediate value from existing data
- ✅ Path to full competitor product analysis
- ✅ No wasted infrastructure (everything gets used)

**Cons:**
- ❌ Still requires manual discovery step

---

## Recommendation: Option 3 (Hybrid)

**Short-term (next 2-3 hours):**
Implement Option 1 to provide immediate value:
- Modify `processCategory()` to analyze seller competition from `competitor_prices`
- Generate category insights: avg price gaps, buy box win rates, seller frequency
- Deploy and show working competitor research page

**Long-term (future session):**
Add Option 2 manual tracking:
- UI to input/manage competitor EANs
- Fetch catalog data for those EANs
- Run AI analysis and display results

This gives you a working feature TODAY while building toward the original vision.

---

## Code Changes Required for Option 1

**File:** `api/bol-sync-competitor-analysis.ts`
**Function:** `processCategory()` (lines 290-330)

**Current logic** (broken):
```typescript
for (const offer of snap.competitor_prices) {
  const competitorEan = offer.ean || offer.EAN; // ← DOESN'T EXIST
  // ...
}
```

**New logic** (analyzes sellers):
```typescript
// Aggregate competitor SELLERS (not EANs)
const sellerFrequency = new Map<string, {
  sellerId: string;
  frequency: number;
  avgPrice: number;
  buyBoxWins: number;
}>();

for (const snap of competitorSnaps) {
  const yourPrice = snap.our_price || 0;

  for (const offer of snap.competitor_prices || []) {
    const sellerId = offer.sellerId;
    if (!sellerId) continue;

    const existing = sellerFrequency.get(sellerId) || {
      sellerId,
      frequency: 0,
      prices: [],
      buyBoxWins: 0
    };

    existing.frequency++;
    if (offer.price) existing.prices.push(offer.price);
    if (offer.isBuyBoxWinner) existing.buyBoxWins++;

    sellerFrequency.set(sellerId, existing);
  }
}

// Rank sellers by frequency
const rankedSellers = Array.from(sellerFrequency.values())
  .sort((a, b) => b.frequency - a.frequency)
  .slice(0, 100);

// Generate insights about seller competition
await generateCategoryInsights(customerId, categorySlug, rankedSellers, supabase);
```

**Changes to `generateCategoryInsights()`:**
- Accept `rankedSellers` instead of `catalogData`
- Calculate: avg competitor price, price gap %, most frequent sellers
- Store in `bol_category_insights` table

**Frontend changes:**
- Update stat tiles to show: "Top Competing Sellers", "Avg Price Gap", "Buy Box Win Rate"
- Update table to show sellers (not products)

---

## Next Steps

**User Decision Required:**
1. ✅ **Option 1** - Pivot to seller competition analysis (fast, immediate value)
2. 🔧 **Option 2** - Add manual competitor EAN tracking (original vision, more work)
3. 💡 **Option 3** - Do Option 1 now, add Option 2 later (recommended)

Let me know which direction you'd like to go, and I'll implement it immediately.

---

## Technical Summary

- **Infrastructure:** 100% complete
- **Data:** 50 products across 4 categories, 200 competitor snapshots
- **Blocker:** API doesn't support category-based product discovery
- **Root Cause:** Retailer API is seller-focused, not marketplace-focused
- **Solution:** Pivot to seller competition OR add manual tracking
- **Estimated Time:**
  - Option 1: 2-3 hours
  - Option 2: 1-2 days
  - Option 3: 2-3 hours (Phase A), then 1-2 days (Phase B)
