# Follo Marketplace Platform — Actieplan

> **Gebruik in Claude Code:** Geef dit bestand mee aan het begin van een nieuwe sessie zodat Claude de context heeft.
> Bijbehorende projectdocumentatie: zie `CLAUDE.md` (developer guide) en `MEMORY.md`.

---

## Mijn advies op de aanpak

**MVP eerst: juist.** Niet herstructureren terwijl de tool nog niet werkt.

**"Later herstructureren": deels riskant.** Bij 30+ klanten is migreren exponentieel duurder dan bij 5. Aanbeveling:

> **Bol MVP → valideer met 3-5 betalende klanten → herstructureer → dan schalen naar 60+**

Doe de herstructurering *niet* na 60 klanten, maar *vóór* de scale-up.

Er zijn een paar beslissingen die je nu voor nul euro kunt nemen, maar na de MVP al moeilijker worden. Die zijn gemarkeerd met ⚠️.

---

## Fase 0 — Bol MVP (prioriteit 1, nu)

**Doel:** Stabiele, demonstreerbare tool die je aan klanten kunt laten zien.

### 0.1 Database migraties uitvoeren
- [ ] Migratie `018_ai_extraction_progress.sql` — controleer of uitgevoerd
- [ ] Migratie `019_bol_ai_product_hashes.sql` — uitvoeren in Supabase SQL editor
- [ ] Verifieer dat beide tabellen bestaan via Supabase dashboard

### 0.2 Keyword pipeline valideren (end-to-end test)
- [ ] Trigger handmatige "Main Sync" voor FashionPower
- [ ] Controleer `bol_product_keyword_targets`: zijn er nu meerdere bronnen? (`content_analysis`, `ai_suggestion`, `advertising`, `category_analysis`)
- [ ] Controleer of category slugs matchen met DB-waarden: `sportleggings` (niet `sportlegging`)
- [ ] Controleer `bol_keyword_performance`: worden ad group keywords gekoppeld aan EANs?
- [ ] Open een productdetail in het dashboard: zijn er nu 10+ keywords zichtbaar in plaats van 1?

### 0.3 AI cron valideren
- [ ] Trigger handmatig: `POST /api/bol-keywords-ai-cron`
- [ ] Check Vercel logs: ziet het `seller_name` correct? Skippet het producten zonder wijzigingen?
- [ ] Check `bol_ai_product_hashes` tabel: worden hashes opgeslagen na verwerking?
- [ ] Verifieer dat de cron in Vercel dashboard staat op `*/15 * * * *`

### 0.4 Content pipeline valideren
- [ ] Upload een test content basis (Excel/CSV) via Content tab
- [ ] Controleer dat `bol_content_base` rijen bevat voor FashionPower
- [ ] Genereer een content voorstel voor één product
- [ ] Doorloop de approve → push flow naar Bol.com

### 0.5 Dashboard stabiliteit
- [ ] Controleer alle stat tiles: tonen ze correcte waarden (niet uit `analysis.findings`)?
- [ ] Priority queue tile: toont het top 5 producten op basis van keyword gaps?
- [ ] Campaign chart: werkt de datumselectie en dual Y-as?
- [ ] Keyword tab: zijn rankings zichtbaar?

### 0.6 MVP-definitie (wanneer is het klaar?)
Het MVP is klaar als een klant het volgende zelf kan doorlopen:
1. Sync triggeren en data zien verschijnen
2. Product zien met meerdere relevante keywords
3. AI content voorstel genereren, beoordelen en pushen naar Bol.com
4. Campaign performance zien met correcte ROAS/ACOS

---

## Fase 1 — Validatie (3-5 klanten)

**Doel:** Bewijs dat het product werkt en waarde levert, vóórdat je schaalt of herstructureert.

### 1.1 Tweede klant onboarden (Bol)
- [ ] Voeg tweede `bol_customers` record toe
- [ ] Voer eerste sync uit, verifieer data-isolatie (RLS werkt correct per klant)
- [ ] Check dat cron jobs beide klanten correct verwerken

### 1.2 Monitoring inrichten
- [ ] Vercel logs actief monitoren de eerste 2 weken
- [ ] Alert instellen als een sync job langer dan 10 minuten open staat in `bol_sync_jobs`
- [ ] Supabase table size bijhouden: `bol_raw_snapshots` groeit snel, retentie bepalen

### 1.3 ⚠️ Eerste Amazon klant — doe dit goed
> Dit is het moment waarop je een vroege architectuurbeslissing kunt nemen zonder grote kosten.
> Als je hier een `amazon_customers` tabel aanmaakt, herhaal je het patroon dat later pijnlijk te migreren is.

- [ ] **Maak geen `amazon_customers` tabel** — voeg een `marketplace` kolom toe aan een unified `sellers` tabel (zie Fase 2)
- [ ] De Amazon API-client bouwen als aparte module met dezelfde interface als `bol-api-client.ts`
- [ ] Nieuwe performance data in unified tabellen zetten met `marketplace` kolom, niet in nieuwe `amazon_campaign_performance` tabellen

### 1.4 Retentie-beleid vaststellen
- [ ] Beslissen: hoe lang bewaar je `bol_raw_snapshots`? (nu: ongelimiteerd)
- [ ] Automated cleanup instellen voor snapshots ouder dan X maanden
- [ ] Time-series performance data: bewaar je altijd alle history of roll je op na 1 jaar?

---

## Fase 2 — Database herstructurering

**Timing:** Na validatie met 3-5 klanten, vóór schalen naar 60+. Schat: 2-4 weken werk.

**Doel:** Unified schema dat Amazon, Bol en Zalando ondersteunt zonder tabel-proliferatie.

### Het kernprobleem
Het huidige `bol_` prefix-patroon schaalt niet. Als Zalando op dezelfde manier wordt toegevoegd, komen er nog eens 15+ `zalando_` tabellen bij. De architectuur behandelt **marketplace als onderdeel van de tabelnaam** in plaats van als datapunt.

### 2.1 Nieuw schema ontwerpen (week 1)

#### Core unified tabellen (nieuw of refactored)
```
sellers
  id, marketplace (enum: bol|amazon|zalando), seller_name,
  credentials JSONB, settings JSONB, active, created_at
  ← vervangt: bol_customers + clients + bol_customer_settings + bol_client_brief

sync_jobs
  seller_id, marketplace, ...
  ← vervangt: bol_sync_jobs

raw_snapshots
  seller_id, marketplace, data_type, raw_data, fetched_at
  ← vervangt: bol_raw_snapshots (structuur al goed, prefix weg)

campaign_performance
  seller_id, marketplace, campaign_id, report_date,
  spend, clicks, impressions, roas, metadata JSONB
  ← vervangt: bol_campaign_performance

keyword_performance
  seller_id, marketplace, ...
  ← vervangt: bol_keyword_performance

product_catalog
  seller_id, marketplace, ean, title, description, ...
  ← unified product data

content_proposals
  seller_id, marketplace, ...
  ← vervangt: bol_content_proposals

analyses
  seller_id, marketplace, ...
  ← vervangt: bol_analyses

product_keyword_targets
  seller_id, marketplace, ean, keyword, priority, source, ...
  ← vervangt: bol_product_keyword_targets

ai_product_hashes
  seller_id, marketplace, ean, content_hash, last_extracted_at
  ← vervangt: bol_ai_product_hashes
```

#### Marketplace-specifieke extensie-tabellen (blijven bestaan)
```
bol_advertising_config          ← Bol-specifieke ad-instellingen
amazon_advertising_config       ← Amazon-specifieke ad-instellingen
category_attribute_requirements ← per marketplace + category (seed data)
competitor_snapshots            ← structuur verschilt per platform
```

#### Tabellen die verdwijnen
```
bol_customer_settings      → JSONB kolom in sellers
bol_client_brief           → JSONB kolom in sellers
bol_content_scores         → berekend via view of onderdeel van product_catalog
bol_ai_extraction_progress → lightweight kolommen in sellers of aparte tabel
```

### 2.2 Migratiestrategie (week 2)
- [ ] Nieuwe tabellen aanmaken náást de bestaande (geen destructieve wijzigingen)
- [ ] DatamigratieScript: kopieer `bol_customers` → `sellers` met `marketplace='bol'`
- [ ] Dubbele writes instellen: API routes schrijven tijdelijk naar zowel oud als nieuw schema
- [ ] Frontend één voor één migreren naar nieuwe endpoints
- [ ] Na validatie: oude tabellen archiveren (niet direct droppen — altijd soft delete eerst)

### 2.3 API-client abstractie (week 2-3)
Definieer een `MarketplaceClient` interface:
```typescript
interface MarketplaceClient {
  authenticate(): Promise<void>
  fetchCampaigns(): Promise<Campaign[]>
  fetchKeywords(): Promise<Keyword[]>
  fetchProducts(): Promise<Product[]>
  fetchOrders(): Promise<Order[]>
  pushContent(ean: string, content: Content): Promise<void>
}
```
- [ ] `BolClient` implementatie (refactor van huidige `bol-api-client.ts`)
- [ ] `AmazonClient` implementatie
- [ ] Sync-logica marketplace-agnostisch maken

### 2.4 Sync-pipeline abstraheren (week 3)
- [ ] `bol-sync-start.ts` / `bol-sync-complete.ts` → generieke `sync-start.ts` / `sync-complete.ts`
- [ ] Keyword-enrichment pipeline marketplace-agnostisch (AI-prompt krijgt marketplace als parameter)
- [ ] Cron jobs unified: één cron verwerkt alle marketplaces

### 2.5 Frontend aanpassen (week 3-4)
- [ ] Dashboard werkt op basis van `seller_id` (niet `bol_customer_id`)
- [ ] Marketplace-switch in UI: klant heeft Bol én Amazon → één dashboard, tabbladen per marketplace
- [ ] Alle hardcoded `bol_` API-aanroepen vervangen door marketplace-agnostische calls

---

## Fase 3 — Amazon op nieuwe foundation

**Timing:** Direct na Fase 2, of parallel als team groot genoeg is.

### 3.1 Amazon Ads integratie uitbreiden
- [ ] Huidige Amazon MCP-integratie migreren naar nieuw seller-model
- [ ] Amazon campaign/keyword performance naar unified `campaign_performance` tabel
- [ ] Amazon product catalog naar unified `product_catalog`

### 3.2 Cross-marketplace features
- [ ] Gecombineerd dashboard: totale spend/revenue over Bol + Amazon per klant
- [ ] Unified content proposal workflow (zelfde AI-pipeline, andere push-client)
- [ ] Cross-marketplace keyword intelligence: keyword presteert goed op Bol → suggereer voor Amazon

---

## Fase 4 — Zalando

**Timing:** Na Amazon stabiel op nieuwe foundation. Zalando heeft andere API-structuur (geen advertising API, andere product-attributen).

### 4.1 Zalando-specifieke analyse
- [ ] Zalando Partner API documentatie doorlopen
- [ ] Attribute requirements catalogiseren (Zalando is attributen-zwaar)
- [ ] Bepalen: heeft Zalando keyword-targeting nodig, of is het puur content-optimalisatie?

### 4.2 Implementatie
- [ ] `ZalandoClient` implementatie van `MarketplaceClient` interface
- [ ] `zalando_category_attribute_requirements` tabel (platform-specifiek)
- [ ] Content pipeline voor Zalando-specifieke eisen (materiaaltabel, maatvoeringen, etc.)

---

## Schaalstappen en risico's

| Klantaantal | Risico | Actie |
|---|---|---|
| 1-5 | Onbekende bugs, data-isolatie | Handmatig monitoren |
| 5-15 | Sync-timing bottlenecks | Cron optimaliseren, batch sizes aanpassen |
| 15-30 | `raw_snapshots` groeit sterk | Retentie-beleid + archivering |
| 30-60 | Performance queries vertragen | Partitionering time-series tabellen |
| 60+ | Multi-tenant RLS performance | Index-strategie herzien |

---

## Wat bewust uitgesteld kan worden

- **Zalando** — wacht op product-marktfit voor Bol + Amazon
- **Postgres partitionering** — relevant pas bij 30+ klanten en 1+ jaar data
- **Aparte read replica** — pas nodig als dashboards traag worden door sync-queries
- **Webhook/event-driven sync** — polling werkt prima tot hoge volumes
- **Multi-region** — niet relevant voor Nederlandse agency

---

## Samenvatting planning

```
Nu (0-1 maand)    → Fase 0: Bol MVP werkend + gevalideerd
1-2 maanden       → Fase 1: 3-5 klanten onboarden + monitoring
                           + ⚠️ eerste Amazon klant correct opzetten
2-4 maanden       → Fase 2: Herstructurering database + API abstractie
4-6 maanden       → Fase 3: Amazon volledig op nieuwe foundation
6+ maanden        → Fase 4: Zalando
```

---

## Technische context voor nieuwe Claude Code sessie

**Huidige staat (na session maart 2026):**
- Keyword bugs gefixed: category slug mismatch, advertising endpoint, table name `bol_content_base`
- AI cron werkend: `bol-keywords-ai-cron.ts` met change detection via `bol_ai_product_hashes`
- Migratie 019 aangemaakt maar nog uit te voeren in Supabase
- Alle fixes gecommit en gepusht naar GitHub

**Kritieke bestanden:**
- `CLAUDE.md` — volledige developer guide, altijd eerst lezen
- `api/_lib/bol-keywords-enrich-core.ts` — kern keyword enrichment (5 bronnen)
- `api/_lib/bol-api-client.ts` — Bol API client incl. `getAdsAdvertisedProducts`
- `api/bol-keywords-ai-cron.ts` — AI cron met change detection
- `supabase/migrations/019_bol_ai_product_hashes.sql` — nog uitvoeren

**Supabase tabellen die recent zijn toegevoegd:**
- `bol_ai_extraction_progress` (migratie 018)
- `bol_ai_product_hashes` (migratie 019)

**FashionPower customer ID:** `a260ef86-9e3a-47cf-9e59-68bf8418e6d8`
