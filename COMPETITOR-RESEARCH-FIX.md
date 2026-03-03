# Competitor Research Fix - Volledige Documentatie

## Probleem

De Competitor Research UI toonde lege tabellen ondanks dat de sync succesvol liep. De `bol_competitor_catalog` tabel bleef leeg en `bol_category_insights` had wel rijen maar zonder competitor data.

## Root Cause

Bol.com gebruikt **twee verschillende category systemen** die volledig incompatibel zijn:

### 1. **Ranking Categories** (Analytics)
- **Bron**: `/retailer/insights/product-ranks` API
- **Formaat**: 8-cijferig (bijv. 30016371, 30016714)
- **Gebruik**: Tracking, analytics, impressions, search rankings
- **Problem**: Deze IDs werken **NIET** met `/retailer/products/list` API

### 2. **Catalog Categories** (Browse/Shop)
- **Bron**: `/retailer/products/categories` + `/retailer/products/{ean}/placement` API
- **Formaat**: 5-cijferig (bijv. 53703, 53704, 46673)
- **Gebruik**: Product browse, category listings, product placement
- **Oplossing**: Deze IDs werken **WEL** met `/retailer/products/list` API

## Onderzoek

### Test Scripts
Meerdere test scripts geschreven om het probleem te identificeren:

1. **test-products-list-simple.js** - Bewees dat `/products/list` werkt met catalog IDs
2. **test-category-tree.js** - Vergeleek beide systemen (0 overlap gevonden)
3. **dump-all-categories.js** - Volledige verificatie: 14,870 catalog categories, 0/6 ranking IDs gevonden
4. **test-product-placement.js** - ✅ **OPLOSSING GEVONDEN!**

### De Oplossing: Placement API

De `/retailer/products/{ean}/placement` API geeft een nested category hierarchy met **catalog category IDs**:

```json
{
  "url": "https://www.bol.com/nl/...",
  "categories": [
    {
      "categoryId": "14648",
      "categoryName": "Sport",
      "subcategories": [
        {
          "id": "53713",
          "name": "Outlet",
          "subcategories": [
            {
              "id": "53702",
              "name": "Sportkleding",
              "subcategories": [
                {
                  "id": "53703",
                  "name": "Sportshirts & Tops"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Deepest category ID (53703)** is compatibel met `/products/list` → 50 producten gevonden ✅

## Implementatie

### 1. Nieuwe Functies in `api/_lib/bol-api-client.ts`

```typescript
// Haal product placement op
export async function getProductPlacement(token: string, ean: string): Promise<BolProductPlacement | null>

// Extract deepest (meest specifieke) category ID
export function extractDeepestCategoryId(placement: BolProductPlacement | null): string | null

// Extract full category path (bijv. "Sport > Outlet > Sportkleding > Sportshirts & Tops")
export function extractCategoryPath(placement: BolProductPlacement | null): string | null
```

### 2. Updated `api/bol-sync-competitor-analysis.ts`

**Voor (broken):**
```typescript
const { ranks } = await getProductRanks(token, ean, dateStr, 'BROWSE');
const topRank = ranks.reduce((best, r) => r.impressions > best.impressions ? r : best, ranks[0]);
const categoryId = topRank.categoryId; // 30016371 (ranking ID) ❌
```

**Na (fixed):**
```typescript
const placement = await client.getProductPlacement(token, ean);
const categoryId = client.extractDeepestCategoryId(placement); // 53703 (catalog ID) ✅
const categoryPath = client.extractCategoryPath(placement); // "Sport > ... > Sportshirts & Tops"
const categoryName = categoryPath?.split(' > ').pop() ?? null; // "Sportshirts & Tops"
```

### 3. Vereenvoudigingen

**Verwijderd:**
- STAP 1: Category tree fetching (niet meer nodig)
- `getProductCategories()` call
- `flattenCategoryTree()` call
- `categoryMap` lookup

**Waarom:** Placement API geeft category names direct in de response.

### 4. API Header Fix

Belangrijk: Placement API vereist specifieke language code:
```typescript
'Accept-Language': 'nl'  // ✅ Werkt
'Accept-Language': 'nl-NL'  // ❌ 406 Not Acceptable
```

## Testing

### Integration Test
```bash
node test-placement-integration.js
```

**Resultaat:**
```
📦 EAN: 8720168075215
  ✅ Category ID: 53703
  ✅ Category Path: Sport > Outlet > Sportkleding > Sportshirts & Tops
  ✅ Category Name: Sportshirts & Tops
  ✅ Category Slug: sportshirts-tops
  ✅ /products/list works: 50 producten gevonden

📦 EAN: 8720246509205
  ✅ Category ID: 53704
  ✅ Category Path: Sport > Outlet > Sportkleding > Sportbroeken & Leggings
  ✅ Category Name: Sportbroeken & Leggings
  ✅ Category Slug: sportbroeken-leggings
  ✅ /products/list works: 50 producten gevonden
```

### TypeScript Verificatie
```bash
npm run typecheck
```
✅ 0 errors

## Impact

### Database Tabellen
Na volgende sync run zullen deze tabellen gevuld worden:
- `bol_product_categories` - Catalog category IDs (in plaats van ranking IDs)
- `bol_competitor_catalog` - Competitor products per category
- `bol_category_insights` - Category-level insights met competitor counts

### UI Components
Competitor Research sectie in `BolDashboard.tsx` zal data tonen:
- Top competitors per category
- Pricing insights
- Content quality vergelijkingen
- Keyword opportunities

## Volgende Stappen

1. **Trigger nieuwe sync**:
   ```bash
   # Via dashboard "Extended Sync" button
   # OF via API:
   POST /api/bol-sync-trigger
   {
     "customerId": "a260ef86-9e3a-47cf-9e59-68bf8418e6d8",
     "syncType": "extended"
   }
   ```

2. **Wacht ~15 minuten** (extended sync duurt lang vanwege rate limiting)

3. **Verifieer data**:
   ```sql
   -- Check category IDs (moeten nu 5-cijferig zijn)
   SELECT DISTINCT category_id, category_name, category_path
   FROM bol_product_categories
   WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

   -- Check competitor catalog (mag niet meer leeg zijn)
   SELECT COUNT(*), category_id
   FROM bol_competitor_catalog
   WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
   GROUP BY category_id;

   -- Check category insights
   SELECT category_name, competitor_count, avg_price, insights
   FROM bol_category_insights
   WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
   ```

4. **Test UI**: Open Bol Dashboard → Competitor Research sectie

## Lessons Learned

1. **API Documentation != Reality**: Bol.com docs don't clearly explain the two category systems
2. **Test Exhaustively**: We validated all 14,870 catalog categories to confirm 0% overlap
3. **Rate Limiting is Aggressive**: 429 errors komen snel, altijd sleep() gebruiken
4. **Language Headers Matter**: Some endpoints require 'nl', others accept 'nl-NL'
5. **Placement API is Underutilized**: This endpoint is the key to bridging ranking and catalog data

## Code Changes Summary

**Modified Files:**
- `api/_lib/bol-api-client.ts` (+70 lines: placement API functions)
- `api/bol-sync-competitor-analysis.ts` (~30 lines changed: use placement instead of product-ranks)

**Test Files Created:**
- `test-product-placement.js`
- `test-placement-integration.js`

**Documentation:**
- This file (`COMPETITOR-RESEARCH-FIX.md`)

---

**Status**: ✅ Fixed, ready for production sync

**Date**: 2026-03-03

**Tested**: Yes (integration tests passed, TypeScript compiles)
