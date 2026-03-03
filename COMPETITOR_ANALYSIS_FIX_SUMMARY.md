# Competitor Analysis Progressive Processing - Fix Summary

## Problem Statement

The Bol.com Competitor Analysis sync was stuck at analyzing only 50 products despite having 500 products in the catalog. Multiple iterations would not progress beyond 50 analyzed products.

## Root Causes Identified

### 1. **Non-Progressive AI Analysis** (CRITICAL)
**Location:** `api/bol-sync-competitor-analysis.ts` line 454-460 (before fix)

**Problem:**
```typescript
// OLD CODE - BROKEN
const { data: catalogProducts } = await supabase
  .from('bol_competitor_catalog')
  .select('competitor_ean, title, description, brand, list_price, attributes')
  .eq('bol_customer_id', customerId)
  .eq('category_slug', category.categorySlug)
  .limit(50); // ALWAYS gets first 50, never progresses!
```

This query ALWAYS fetched the FIRST 50 products from the catalog, regardless of which products were already analyzed. Every run would re-analyze the same 50 products.

**Fix:**
```typescript
// NEW CODE - PROGRESSIVE
// 1. Get already-analyzed EANs
const { data: existingAnalysis } = await supabase
  .from('bol_competitor_content_analysis')
  .select('competitor_ean')
  .eq('bol_customer_id', customerId)
  .eq('category_slug', category.categorySlug);

const analyzedEans = new Set((existingAnalysis || []).map(a => a.competitor_ean));

// 2. Get ALL catalog products
const { data: allCatalogProducts } = await supabase
  .from('bol_competitor_catalog')
  .select('competitor_ean, title, description, brand, list_price, attributes')
  .eq('bol_customer_id', customerId)
  .eq('category_slug', category.categorySlug);

// 3. Filter to UNANALYZED products, then limit to 50
const catalogProducts = (allCatalogProducts || [])
  .filter(p => !analyzedEans.has(p.competitor_ean))
  .slice(0, 50);
```

**Impact:** Now each run processes the NEXT 50 unanalyzed products (50→100→150→...→500).

---

### 2. **Time-Based Category Skip Logic** (CRITICAL)
**Location:** `api/bol-sync-competitor-analysis.ts` line 240-252 (before fix)

**Problem:**
```typescript
// OLD CODE - BROKEN
const oneHourAgo = new Date();
oneHourAgo.setHours(oneHourAgo.getHours() - 1);

const { data: recentCategories } = await supabase
  .from('bol_competitor_catalog')
  .select('category_slug')
  .eq('bol_customer_id', customer.id)
  .gte('fetched_at', oneHourAgo.toISOString());

const recentlySynced = new Set(recentCategories.map(c => c.category_slug));
```

This checked `fetched_at` in `bol_competitor_catalog`, but:
- The 500 sportleggings records had OLD timestamps (from local test)
- UPSERT doesn't update `fetched_at` for existing records
- So sportleggings was NEVER marked as "recently synced"
- Every iteration kept processing sportleggings instead of moving to next category

**Fix:**
```typescript
// NEW CODE - COMPLETION-BASED
// 1. Get catalog vs analysis counts per category
const catalogByCategory = new Map<string, Set<string>>();
const analysisByCategory = new Map<string, Set<string>>();

// ... group by category ...

// 2. Mark category as done only if ALL products analyzed
for (const [catSlug, catalogEans] of catalogByCategory.entries()) {
  const analyzedEans = analysisByCategory.get(catSlug) || new Set();
  const allAnalyzed = Array.from(catalogEans).every(ean => analyzedEans.has(ean));
  if (allAnalyzed && catalogEans.size > 0) {
    fullyAnalyzedCategories.add(catSlug);
  }
}
```

**Impact:** Category only gets skipped when 100% analyzed, not based on stale timestamps.

---

### 3. **Missing `is_customer_product` Field** (MINOR)
**Location:** `api/bol-sync-competitor-analysis.ts` line 514-530

**Problem:**
When querying catalog data for insights generation, the `is_customer_product` field was not included. This caused `competitor_count: 0` in insights because the filter logic failed.

**Fix:**
```typescript
// Added is_customer_product to SELECT and mapping
const { data: allCatalogData } = await supabase
  .from('bol_competitor_catalog')
  .select('competitor_ean, title, brand, list_price, is_customer_product') // Added field
  .eq('bol_customer_id', customerId)
  .eq('category_slug', category.categorySlug);

const allCatalogInserts = (allCatalogData || []).map(c => ({
  // ...
  is_customer_product: c.is_customer_product ?? false, // Added field
}));
```

---

## Testing

### Test 1: Progressive Logic Simulation
**File:** `test-progressive-analysis.js`

**Results:**
```
Current state: 50/500 analyzed
Run 1: analyze 50 products → 100/500 total
Run 2: analyze 50 products → 150/500 total
...
Run 9: analyze 50 products → 500/500 total
✅ SUCCESS: All 500 products analyzed after 9 runs
```

### Test 2: Actual Code Execution (Dry Run)
**File:** `test-actual-analysis-run.js`

**Results:**
```
✅ Query gets unanalyzed products correctly
✅ Filter logic excludes already-analyzed EANs
✅ Limit to 50 works as expected
✅ Data mapping is correct
✅ UPSERT structure is valid
✅ Progressive analysis would work over multiple runs
```

### Test 3: TypeScript Compilation
```bash
npm run typecheck
# ✅ No errors
```

---

## Expected Behavior After Fix

### Current State
- `bol_competitor_catalog`: 500 sportleggings products
- `bol_competitor_content_analysis`: 50 analyzed products

### After Deployment

**Run 1:** Analyze products 51-100 (total: 100/500)
**Run 2:** Analyze products 101-150 (total: 150/500)
**Run 3:** Analyze products 151-200 (total: 200/500)
**Run 4:** Analyze products 201-250 (total: 250/500)
**Run 5:** Analyze products 251-300 (total: 300/500)
**Run 6:** Analyze products 301-350 (total: 350/500)
**Run 7:** Analyze products 351-400 (total: 400/500)
**Run 8:** Analyze products 401-450 (total: 450/500)
**Run 9:** Analyze products 451-500 (total: 500/500)
**Run 10:** Skip sportleggings (fully analyzed), process next category ✅

---

## Code Changes Summary

| File | Lines Changed | Change Type |
|------|---------------|-------------|
| `bol-sync-competitor-analysis.ts` | 240-284 | Category skip logic: time-based → completion-based |
| `bol-sync-competitor-analysis.ts` | 483-508 | AI analysis: first-50 → progressive unanalyzed |
| `bol-sync-competitor-analysis.ts` | 565, 577 | Added `is_customer_product` field |

---

## Commits

1. `ca378e25` - fix: include is_customer_product field in category insights calculation
2. `500306fa` - fix: progressive analysis - only analyze unanalyzed products
3. `918a9dad` - fix: remove non-existent RPC call causing 500 error

---

## Verification Steps

1. ✅ Code review: All logic verified
2. ✅ TypeScript compilation: No errors
3. ✅ Simulation tests: Both pass 100%
4. ✅ Dry run test: All steps execute correctly
5. 🔄 **Ready for deployment**

---

## Next Steps

1. Deploy to Vercel (push already done)
2. Wait ~2 minutes for deployment
3. Run competitor analysis sync via dashboard
4. Verify progressive analysis in database:
   - Check `bol_competitor_content_analysis` row count increases by 50 each run
   - After 9 runs, should have 500 analyzed products
   - Run 10 should process a different category
