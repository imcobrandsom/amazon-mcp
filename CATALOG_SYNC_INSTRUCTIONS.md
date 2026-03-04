# Catalog Sync Setup - Product Descriptions & Attributes

## Wat is geïmplementeerd

Er is nu een systeem om **alle product attributen** (inclusief descriptions) op te halen van de Bol.com Catalog API en op te slaan in de database.

### Nieuwe features:
1. **Database kolom**: `bol_raw_snapshots.catalog_attributes` (JSONB) - slaat alle product metadata op
2. **Sync endpoint**: `POST /api/bol-sync-catalog` - haalt catalog data op voor alle producten
3. **Product API**: `GET /api/bol-products` - geeft nu ook `description` en `catalogAttributes` terug
4. **TypeScript types**: `BolCatalogAttributes` interface met alle bekende velden

---

## Stap 1: Database migratie uitvoeren

Voer de volgende SQL uit in de **Supabase SQL Editor**:

```sql
ALTER TABLE bol_raw_snapshots
ADD COLUMN IF NOT EXISTS catalog_attributes JSONB DEFAULT NULL;

-- IMPORTANT: Add 'catalog' to the data_type CHECK constraint
ALTER TABLE bol_raw_snapshots
DROP CONSTRAINT IF EXISTS bol_raw_snapshots_data_type_check;

ALTER TABLE bol_raw_snapshots
ADD CONSTRAINT bol_raw_snapshots_data_type_check
CHECK (data_type IN ('listings', 'inventory', 'orders', 'offer_insights',
                     'advertising', 'returns', 'performance', 'catalog'));

CREATE INDEX IF NOT EXISTS idx_bol_raw_snapshots_catalog_attrs
ON bol_raw_snapshots USING gin(catalog_attributes);

COMMENT ON COLUMN bol_raw_snapshots.catalog_attributes IS
'Full catalog product attributes from /retailer/content/catalog-products/{ean} - includes Description, Title, and all other product metadata';
```

**Hoe:**
1. Ga naar [Supabase Dashboard](https://supabase.com/dashboard)
2. Selecteer je project
3. Klik op "SQL Editor" in de linker sidebar
4. Plak bovenstaande SQL en klik "Run"

---

## Stap 2: Catalog sync uitvoeren (eerste keer)

De catalog sync haalt voor **elk product** de volledige catalog data op via de API.

⚠️ **Important:** Due to Vercel's 60-second timeout limit, the sync processes **50 products per run**. For 784 products, you need to run it ~16 times (or use the automated script).

### Option A: Automated script (recommended):

```bash
# Run full sync automatically (handles all batches)
./scripts/run-full-catalog-sync.sh
```

This script will:
- Run the sync endpoint repeatedly until all products are processed
- Show progress after each batch
- Handle errors gracefully
- Complete in ~12-15 minutes for 784 products

### Option B: Manual curl (single batch of 50 products):

```bash
# FashionPower customer ID
CUSTOMER_ID="a260ef86-9e3a-47cf-9e59-68bf8418e6d8"

curl -X POST https://amazon-mcp-eight.vercel.app/api/bol-sync-catalog \
  -H "Content-Type: application/json" \
  -d "{\"customerId\": \"$CUSTOMER_ID\"}"
```

Then run it again until `"complete": true` (check `remaining_to_process` in response).

### Response voorbeeld:
```json
{
  "customer_id": "a260ef86-9e3a-47cf-9e59-68bf8418e6d8",
  "seller_name": "FashionPower",
  "total_eans": 784,
  "success_count": 780,
  "error_count": 4,
  "duration_ms": 82456,
  "errors": [
    { "ean": "1234567890123", "error": "No catalog data returned" }
  ]
}
```

---

## Stap 3: Verificatie

Test of de data correct is opgeslagen:

```bash
# Check of descriptions nu beschikbaar zijn
curl "https://amazon-mcp-eight.vercel.app/api/bol-products?customerId=a260ef86-9e3a-47cf-9e59-68bf8418e6d8" | jq '.products[0]'
```

Je zou nu moeten zien:
```json
{
  "ean": "8720246504583",
  "title": "Redmax Sportlegging Dames...",
  "description": "<p>Sportlegging Dames<br />Deze zwarte dames sportbroek...</p>",
  "catalogAttributes": {
    "Description": "<p>Sportlegging Dames<br />Deze zwarte dames sportbroek...</p>",
    "Title": "Redmax Sportlegging Dames - High Waist...",
    "Colour": "Zwart",
    "Size Clothing": "M",
    "Material": ["Elastaan", "Polyester"],
    "_brand": "redmax",
    "_published": true
  }
}
```

---

## Beschikbare Catalog Attributen

De volgende velden worden opgeslagen in `catalogAttributes`:

### Core fields:
- `Description` - HTML formatted product beschrijving
- `Title` - Volledige producttitel
- `Family Name` - Product familie naam
- `SEO Slug` - URL-vriendelijke naam

### Product details:
- `Colour`, `Colour Group`
- `Size Clothing`
- `Material` (kan array zijn)
- `Pattern`
- `Gender`

### Fashion specific:
- `Fit Form`
- `Clothing Length Indication`
- `Fashion Seasonal Collection`
- `Type of Fashion`

### Sports specific:
- `Type of Sport`
- `Options for Sports Clothing`

### Physical:
- `Height`, `Width`, `Length`, `Weight` (met units)

### Metadata:
- `_published` - Boolean (is product gepubliceerd)
- `_gpc_chunk_id` - Global Product Classification
- `_enrichment_status` - Bol.com enrichment status
- `_brand` - Merk naam

---

## Onderhoud

### Hoe vaak moet catalog sync draaien?

**Aanbeveling:** 1x per week of bij nieuwe producten

Catalog data (descriptions, attributen) verandert zelden. Alleen nodig bij:
- Nieuwe producten toegevoegd
- Content updates (nieuwe descriptions geschreven)
- Seizoenswijzigingen

### Integratie in bestaande sync flow:

Optie 1: **Handmatig triggeren** wanneer nodig
```bash
curl -X POST https://amazon-mcp-eight.vercel.app/api/bol-sync-catalog \
  -H "Content-Type: application/json" \
  -d '{"customerId": "a260ef86-9e3a-47cf-9e59-68bf8418e6d8"}'
```

Optie 2: **Dashboard knop toevoegen** (toekomstig)
- Voeg "Sync Catalog" knop toe aan BolDashboard
- Toont progress bar tijdens sync
- Toont success/error count na afloop

---

## Frontend integratie

De descriptions zijn nu beschikbaar in de producten lijst:

```typescript
// In BolDashboard.tsx of ProductsSection
const products = await fetchBolProducts(customerId);

products.forEach(product => {
  console.log('Description:', product.description); // Direct beschikbaar
  console.log('Brand:', product.catalogAttributes?._brand);
  console.log('Material:', product.catalogAttributes?.Material);
});
```

### Voorbeeld: Description quality analysis

```typescript
const descriptionStats = useMemo(() => {
  const withDesc = products.filter(p => p.description && p.description.length > 100);
  const withoutDesc = products.filter(p => !p.description || p.description.length < 100);

  return {
    total: products.length,
    with_description: withDesc.length,
    without_description: withoutDesc.length,
    avg_length: withDesc.reduce((sum, p) => sum + (p.description?.length || 0), 0) / withDesc.length,
  };
}, [products]);
```

---

## Troubleshooting

### "No catalog data returned" errors

Sommige EANs hebben geen catalog data in Bol.com:
- Nieuwe producten (nog niet geïndexeerd)
- Verwijderde producten
- Invalid EANs

Dit is normaal - negeer deze errors (max 1-2%).

### Rate limiting (429 errors)

De sync gebruikt automatisch:
- 100ms pauze tussen calls (10 calls/seconde)
- 5 seconden wachten bij 429 error
- Retry logic

Als je veel 429 errors ziet, verhoog de sleep time in `bol-sync-catalog.ts`.

### Timeout errors

Vercel functions hebben een 60 seconden timeout. Voor grote catalogs (>600 producten):
- Sync zal automatisch zoveel mogelijk producten verwerken
- Run meerdere keren tot alle producten zijn gedaan
- Check `success_count` vs `total_eans`

---

## Next Steps

Na deze setup kun je:
1. ✅ Description quality analysis toevoegen aan dashboard
2. ✅ Product filtering op attributen (bijv. alleen sportleggings)
3. ✅ Content improvement suggestions genereren
4. ✅ SEO analysis (title length, keyword usage)
