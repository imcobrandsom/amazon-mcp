# Bol.com API Gap Analysis & Implementation Plan

_Generated 2026-02-26 · Based on bol.com Retailer API v10 + Advertising API v1_

---

## 1. Current State — What Is Actually Connected

| Data | API endpoint | Stored? | Displayed? |
|---|---|---|---|
| Product offers (CSV export) | `POST /retailer/offers/export` → poll → download | ✅ `bol_analyses.content` | ✅ Products tab |
| Inventory (FBB stock) | `GET /retailer/inventory` | ✅ `bol_analyses.inventory` | ✅ Inventory tab |
| Orders (FBR only 🐛) | `GET /retailer/orders?fulfilment-method=FBR` | ✅ `bol_analyses.orders` | ✅ Orders tab |
| Offer insights (impressions/clicks) | `GET /retailer/insights/offer` | ❌ never called in sync | ❌ |
| Ads campaigns | `GET /api/v1/campaigns` | ❌ never called in sync | ❌ placeholder |
| Ads ad groups | `GET /api/v1/campaigns/{id}/ad-groups` | ❌ never called in sync | ❌ placeholder |
| Ads performance report | `GET /api/v1/sponsored-products/performance-report` | ❌ never called in sync | ❌ placeholder |

**Three API client functions exist but are never called:** `getOfferInsights()`, `getAdsCampaigns()`, `getAdsAdGroups()`, `getAdsPerformance()`.

---

## 2. Known Bugs to Fix First

### Bug 1 — Orders only fetch FBR, completely missing FBB orders
- **File:** `api/_lib/bol-api-client.ts` → `getOrders()`
- **Current:** `GET /retailer/orders?fulfilment-method=FBR&status=ALL&page=N`
- **Fix:** Change to `fulfilment-method=ALL` so FBB orders are included

### Bug 2 — Offer insights never synced
- **Files:** `api/bol-sync-start.ts`, `api/bol-sync-manual.ts`
- The `getOfferInsights()` function exists in the client but is never called during sync
- Should be called after downloading the offers CSV (to get offer IDs), then storing the result

---

## 3. Missing Connections — Grouped by Dashboard Section

---

### Section A: Campaign Performance _(placeholder exists, just needs wiring)_

**What we already have in the API client (just not called):**
- `getAdsCampaigns(adsToken)` → campaign list
- `getAdsAdGroups(adsToken, campaignId)` → ad groups per campaign
- `getAdsPerformance(adsToken, dateFrom, dateTo)` → spend / ROAS / impressions

**What needs to be added to the API client:**
- Share of Voice by search term: `POST /advertising/reports/share-of-voice/search-terms`
- Share of Voice by category: `POST /advertising/reports/share-of-voice/categories`
- Retrieve SoV report: `GET /advertising/reports/share-of-voice/{reportId}`

**Implementation steps:**
1. In `bol-sync-start.ts` / `bol-sync-manual.ts`: if `ads_client_id` is set, call `getAdsCampaigns()` + loop `getAdsAdGroups()` + call `getAdsPerformance()` for last 30 days
2. Store result in `bol_raw_snapshots` with `data_type = 'advertising'` and in `bol_analyses` with `category = 'advertising'`
3. Add `analyzeAdvertising(campaigns, performance)` function to `bol-analysis.ts` that computes:
   - Total spend, impressions, clicks, conversions
   - ROAS per campaign
   - Budget utilisation (spend / budget)
   - Underperforming campaigns (high spend / low ROAS)
4. Wire up the Campaign Performance section in `BolDashboard.tsx`

---

### Section B: Keyword Intelligence _(placeholder, no backend at all)_

**New API endpoints needed — add to `api/_lib/bol-api-client.ts`:**

```
GET /retailer/insights/search-terms?search-term={term}&period=WEEK&number-of-periods=8&related-search-terms=true
```
Returns: search volume, trend, related terms for any search query

```
GET /retailer/insights/product-ranks?ean={ean}&search-type=SEARCH
GET /retailer/insights/product-ranks?ean={ean}&search-type=BROWSE
```
Returns: rank position + impressions for a product in search vs browse

**What to sync:**
- For each EAN in the seller's offer export, fetch product ranks (SEARCH + BROWSE)
- For top search terms from campaigns, fetch search-term data
- Store in `bol_analyses` with `category = 'keywords'`

**Dashboard display:**
- Table of products with their current search rank + browse rank
- Trending keywords from campaign data
- Keyword gap: terms that competitors rank for but seller doesn't target

---

### Section C: Competitor Research _(placeholder, no backend at all)_

**New API endpoints needed — add to `api/_lib/bol-api-client.ts`:**

```
GET /retailer/products/{ean}/offers?include-refurbished-conditions=false
```
Returns: ALL sellers offering that EAN, their prices, conditions, delivery codes — the buy box winner is identifiable

```
GET /retailer/products/{ean}/ratings
```
Returns: aggregate star rating + count per rating level (1–5 stars)

```
GET /retailer/products/{ean}/price-star-boundaries
```
Returns: the price brackets that define the 1–5 "price star" display on bol.com

```
GET /retailer/commission/{ean}?condition=NEW&unit-price={price}
```
Returns: commission % and amount at a given price — useful for margin calculations

```
GET /retailer/products/{ean}/placement
```
Returns: which category the product is listed in + its URL on bol.com

**What to sync (per EAN in the seller's catalogue):**
- Competing offers list → identify buy box winner, lowest price, number of competitors
- Ratings → store score + count
- Price star boundaries → identify which "price star tier" seller sits in

**Dashboard display:**
- Per-product: buy box winner (you / competitor), your price vs lowest price, # competitors
- Rating score + review count per product
- Products where seller is NOT winning the buy box (biggest opportunity list)
- Price positioning map (are you in the optimal price-star tier?)

---

### Section D: Products tab — enhance existing

**Currently shows:** title quality from CSV (char count, missing titles, price set %)

**What to add:**

```
GET /retailer/content/catalog-products/{ean}
```
Returns: full published attributes from the bol.com catalog — description, specs, categories, enrichment status. This reveals what data is published vs missing.

```
GET /retailer/products/{ean}/assets
```
Returns: all product images and their usage type (PRIMARY, ADDITIONAL, etc.)

```
GET /retailer/offers/{offerId}
```
Returns: detailed offer data including delivery code, condition, stock, pricing tiers

**Dashboard display:**
- Expand Products tab into a product list (one row per EAN)
- Each row: thumbnail image, title, EAN, offer ID, buy box status, review score
- Click into a product → product detail modal with full content audit

---

### Section E: Returns _(new tab to add)_

**New API endpoint:**

```
GET /retailer/returns?fulfilment-method=ALL&handled=false
GET /retailer/returns?fulfilment-method=ALL&handled=true
```
Returns: return items with reason codes, quantities, processing results

**What to sync:**
- Fetch open + recent handled returns
- Analyse return rate per product, top return reason codes

**Dashboard display (new "Returns" nav item):**
- Return rate % overall + trend
- Top return reasons ranked by frequency
- Products with high return rates flagged
- Unhandled returns requiring action

---

### Section F: Seller Performance KPIs _(add to Overview tab)_

**New API endpoint:**

```
GET /retailer/insights/performance/indicator?week={week}&year={year}&name=CANCELLATION_RATE
GET /retailer/insights/performance/indicator?week={week}&year={year}&name=FULFILMENT_RATE
```
Returns: bol.com's official seller performance metrics — these are the KPIs bol.com uses to rate and potentially suspend sellers

Available indicators (each fetched separately):
- `CANCELLATION_RATE` — % of orders cancelled by seller
- `FULFILMENT_RATE` — % of orders fulfilled on time
- `RETURN_RATE` — % returned
- `REVIEW_RATING` — seller review score

**Dashboard display:**
- Add a "Bol.com Performance Score" card to the Overview tab
- Show each official KPI with traffic-light status (bol.com thresholds built in)
- This is separate from our own computed scores — it shows what bol.com themselves report

---

### Section G: Sales Forecast _(add to Products or new tab)_

**New API endpoint:**

```
GET /retailer/insights/sales-forecast?offer-id={offerId}&weeks-ahead=8
```
Returns: ML-predicted sales volume for the next N weeks per offer

**Dashboard display:**
- On the product list / detail view: show "Predicted sales next 8 weeks"
- Use this to flag products that need replenishment now based on forecast vs current stock

---

### Section H: Buy Box % & Product Visits _(fix existing Offer Insights)_

The existing `getOfferInsights()` call only requests `IMPRESSIONS`, `CLICKS`, `CONVERSIONS`.

**The API also supports:**
```
GET /retailer/insights/offer?offer-id={id}&period=WEEK&number-of-periods=4&name=BUY_BOX_PERCENTAGE
GET /retailer/insights/offer?offer-id={id}&period=WEEK&number-of-periods=4&name=PRODUCT_VISITS
```

**Fix:** Make two separate calls (or extend the existing one) to also fetch `BUY_BOX_PERCENTAGE` and `PRODUCT_VISITS`. Store these in findings. Display on the Products tab as sparklines per product.

---

## 4. Prioritised Implementation Roadmap

### Priority 1 — Bug fixes (do immediately, 1 session)
| # | Task | Files |
|---|---|---|
| 1.1 | Fix `getOrders()` to use `fulfilment-method=ALL` | `api/_lib/bol-api-client.ts` |
| 1.2 | Call `getOfferInsights()` during sync + store result | `api/bol-sync-manual.ts`, `api/bol-sync-start.ts` |
| 1.3 | Add `BUY_BOX_PERCENTAGE` + `PRODUCT_VISITS` to insights fetch | `api/_lib/bol-api-client.ts` |

---

### Priority 2 — Campaign Performance (1–2 sessions)
Makes the existing placeholder a real section. All API functions exist, just need wiring.

| # | Task | Files |
|---|---|---|
| 2.1 | Add advertising sync to `bol-sync-manual.ts` + `bol-sync-start.ts` | sync files |
| 2.2 | Add `analyzeAdvertising()` to `bol-analysis.ts` | `api/_lib/bol-analysis.ts` |
| 2.3 | Add new Vercel endpoint `api/bol-ads-data.ts` to expose ads data to frontend | new file |
| 2.4 | Build Campaign Performance UI in `BolDashboard.tsx` | `src/pages/BolDashboard.tsx` |

**Metrics to display:** Total spend, impressions, clicks, CTR, conversions, ROAS, budget used % — per campaign with drill-down into ad groups.

---

### Priority 3 — Competitor Research (2 sessions)
Highest business value for the agency. Requires per-EAN API calls.

| # | Task | Files |
|---|---|---|
| 3.1 | Add `getCompetingOffers(token, ean)` to api-client | `api/_lib/bol-api-client.ts` |
| 3.2 | Add `getProductRatings(token, ean)` to api-client | `api/_lib/bol-api-client.ts` |
| 3.3 | Add `getPriceStarBoundaries(token, ean)` to api-client | `api/_lib/bol-api-client.ts` |
| 3.4 | Add competitor sync pass in `bol-sync-start.ts` (one EAN per job to spread load) | sync file |
| 3.5 | Store in new `bol_competitor_snapshots` table (Supabase migration 005) | new migration |
| 3.6 | Add `api/bol-competitors.ts` Vercel endpoint | new file |
| 3.7 | Build Competitor Research UI in `BolDashboard.tsx` | `src/pages/BolDashboard.tsx` |

**Metrics to display:** Buy box win % per product, competitor count, price positioning, your rank vs lowest price, review comparison.

---

### Priority 4 — Keyword Intelligence (2 sessions)

| # | Task | Files |
|---|---|---|
| 4.1 | Add `getProductRanks(token, ean, searchType)` to api-client | `api/_lib/bol-api-client.ts` |
| 4.2 | Add `getSearchTermInsights(token, term)` to api-client | `api/_lib/bol-api-client.ts` |
| 4.3 | Add keyword sync pass (rank per EAN + top campaign search terms) | sync file |
| 4.4 | Store in `bol_analyses` with `category = 'keywords'` | via existing schema |
| 4.5 | Build Keyword Intelligence UI | `src/pages/BolDashboard.tsx` |

**Metrics to display:** Search rank per product (SEARCH + BROWSE), rank trend over weeks, top performing search terms from campaigns, keyword gap opportunities.

---

### Priority 5 — Returns & Seller KPIs (1 session)
Low effort, high trust signal for clients.

| # | Task | Files |
|---|---|---|
| 5.1 | Add `getReturns(token)` to api-client | `api/_lib/bol-api-client.ts` |
| 5.2 | Add `getPerformanceIndicator(token, week, year, name)` to api-client | `api/_lib/bol-api-client.ts` |
| 5.3 | Sync both, store in `bol_analyses` | sync files |
| 5.4 | Add Returns nav item to `BolDashboard.tsx` | `src/pages/BolDashboard.tsx` |
| 5.5 | Add official KPI cards to Overview tab | `src/pages/BolDashboard.tsx` |

---

### Priority 6 — Product Content Deep-Dive & Sales Forecast (2 sessions)
Makes Products tab a full product management view.

| # | Task | Files |
|---|---|---|
| 6.1 | Add `getCatalogProduct(token, ean)` to api-client | `api/_lib/bol-api-client.ts` |
| 6.2 | Add `getProductAssets(token, ean)` to api-client | `api/_lib/bol-api-client.ts` |
| 6.3 | Add `getSalesForecast(token, offerId, weeksAhead)` to api-client | `api/_lib/bol-api-client.ts` |
| 6.4 | Sync catalog content + images per EAN | sync files |
| 6.5 | Build product list with images, full content audit per EAN | `src/pages/BolDashboard.tsx` |

---

## 5. New Database Objects Required

| Migration | Table / Column | Purpose |
|---|---|---|
| `005_bol_competitor_data.sql` | `bol_competitor_snapshots` | Per-EAN competitor offers, ratings, pricing tiers |
| `005_bol_competitor_data.sql` | `bol_keyword_rankings` | Product rank per EAN per week (SEARCH + BROWSE) |
| Existing `bol_analyses` | `category = 'advertising'` | Ads data uses existing schema |
| Existing `bol_analyses` | `category = 'keywords'` | Keyword summary uses existing schema |
| Existing `bol_analyses` | `category = 'returns'` | Returns analysis uses existing schema |

---

## 6. New Vercel API Endpoints Required

| File | Method | Purpose |
|---|---|---|
| `api/bol-ads-data.ts` | GET | Expose advertising analyses to frontend |
| `api/bol-competitors.ts` | GET | Expose competitor snapshots per EAN |
| `api/bol-keywords.ts` | GET | Expose keyword rankings to frontend |

---

## 7. Summary of API Endpoints to Add

| Endpoint | Section | Priority |
|---|---|---|
| `GET /retailer/orders?fulfilment-method=ALL` | Orders bug fix | P1 |
| `GET /retailer/insights/offer?name=BUY_BOX_PERCENTAGE` | Products | P1 |
| `GET /retailer/insights/offer?name=PRODUCT_VISITS` | Products | P1 |
| `GET /api/v1/campaigns` (call existing fn in sync) | Campaigns | P2 |
| `GET /api/v1/campaigns/{id}/ad-groups` (call existing fn) | Campaigns | P2 |
| `GET /api/v1/sponsored-products/performance-report` (existing) | Campaigns | P2 |
| `POST /advertising/reports/share-of-voice/search-terms` | Campaigns | P2 |
| `GET /retailer/products/{ean}/offers` | Competitors | P3 |
| `GET /retailer/products/{ean}/ratings` | Competitors | P3 |
| `GET /retailer/products/{ean}/price-star-boundaries` | Competitors | P3 |
| `GET /retailer/commission/{ean}` | Competitors | P3 |
| `GET /retailer/insights/product-ranks` | Keywords | P4 |
| `GET /retailer/insights/search-terms` | Keywords | P4 |
| `GET /retailer/returns` | Returns | P5 |
| `GET /retailer/insights/performance/indicator` | Overview KPIs | P5 |
| `GET /retailer/content/catalog-products/{ean}` | Products detail | P6 |
| `GET /retailer/products/{ean}/assets` | Products detail | P6 |
| `GET /retailer/insights/sales-forecast` | Products detail | P6 |
