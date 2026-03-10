# Content Training Admin UI — Gebruikershandleiding

## Overzicht

De Content Training Admin UI (`/admin/content-training`) biedt een interface voor het beheren van:

1. **Content Examples** — goede/slechte voorbeelden van titels en beschrijvingen voor AI few-shot learning
2. **Category Guidelines** — categorie-specifieke richtlijnen (focus areas, tone, USPs, templates)
3. **Test Prompt** — preview van welke examples en guidelines gebruikt worden per categorie

---

## Setup (Eenmalig)

### 1. Run Database Migrations

Open Supabase SQL Editor en voer beide migraties uit (in volgorde):

```sql
-- File: supabase/migrations/026_content_examples.sql
-- (kopieer volledige inhoud en run)

-- File: supabase/migrations/027_category_content_guidelines.sql
-- (kopieer volledige inhoud en run)
```

**Verificatie:**
```sql
-- Check content_examples table exists
SELECT COUNT(*) FROM content_examples;
-- Expected: 0 rows (empty table)

-- Check new columns exist
SELECT content_focus_areas, tone_guidelines, priority_usps, attribute_templates
FROM bol_category_attribute_requirements
LIMIT 1;
-- Expected: all columns return NULL (nog geen data)
```

### 2. Seed Initial Data

Voer beide seed files uit:

```sql
-- File: supabase/seeds/content_examples_bol.sql
-- (kopieer volledige inhoud en run)

-- File: supabase/seeds/category_guidelines.sql
-- (kopieer volledige inhoud en run)
```

**Verificatie:**
```sql
-- Check seeded examples
SELECT marketplace, category_slug, example_type, COUNT(*)
FROM content_examples
GROUP BY marketplace, category_slug, example_type
ORDER BY category_slug, example_type;

-- Expected:
-- bol | laptops         | bad_description  | 1
-- bol | laptops         | bad_title        | 2
-- bol | laptops         | good_description | 1
-- bol | laptops         | good_title       | 2
-- bol | sport-bhs       | bad_title        | 2
-- bol | sport-bhs       | good_title       | 2
-- bol | sportlegging    | bad_description  | 1
-- bol | sportlegging    | bad_title        | 2
-- bol | sportlegging    | good_description | 1
-- bol | sportlegging    | good_title       | 2

-- Check seeded guidelines
SELECT category_slug, content_focus_areas, priority_usps
FROM bol_category_attribute_requirements
WHERE content_focus_areas IS NOT NULL;

-- Expected: 3 rows (sportlegging, sport-bhs, laptops)
```

### 3. Deploy Backend API Routes

De volgende nieuwe API endpoints zijn aangemaakt:

- `/api/admin/content-examples.ts` — CRUD voor content examples
- `/api/admin/category-guidelines.ts` — Update voor category guidelines

**Verificatie (na deploy):**
```bash
# Test content examples endpoint
curl https://jouw-vercel-url.vercel.app/api/admin/content-examples?marketplace=bol

# Test category guidelines endpoint
curl https://jouw-vercel-url.vercel.app/api/admin/category-guidelines
```

### 4. Toegang tot Admin UI

Navigeer naar: **`/admin/content-training`**

---

## Tab 1: Content Examples

### Voorbeelden Bekijken

**Filters:**
- **Marketplace:** Bol.com / Amazon / Generic
- **Category:** Leeg = alle categories, invullen = filter op specifieke category (bijv. `sportlegging`)
- **Type:** Alles / Good Title / Bad Title / Good Description / Bad Description

**Tabel kolommen:**
- **Type:** Good/bad + title/description (groene/rode badge)
- **Category:** Category slug (of `—` voor generic examples)
- **Content:** De volledige voorbeeld titel/beschrijving (truncated, hover voor volledig)
- **Reason:** Waarom dit voorbeeld goed/slecht is (truncated, hover voor volledig)
- **Rating:** 1-5 sterren (5 = beste voorbeelden, 1 = slechtste)
- **Usage:** Hoe vaak dit voorbeeld is gebruikt (future: track effectiviteit)
- **Actions:** Edit / Delete

### Nieuw Voorbeeld Toevoegen

1. Klik **"+ Nieuw Voorbeeld"**
2. Vul formulier in:
   - **Marketplace:** Bol.com / Amazon / Generic
   - **Language:** Nederlands / English / Deutsch / Français
   - **Type:** Good Title / Bad Title / Good Description / Bad Description
   - **Category:** Optioneel (leeg = generic example voor alle categories)
   - **Content:** De volledige voorbeeld tekst
   - **Reason:** Waarom dit voorbeeld goed/slecht is (wordt getoond aan AI in prompt)
   - **Rating:** 1-5 (5 = beste voorbeeld, wordt eerst gekozen bij fetch)
3. Klik **"Opslaan"**

**Best Practices:**
- **Good examples:** Concrete, diverse voorbeelden die verschillende patronen laten zien
- **Bad examples:** Veelgemaakte fouten met duidelijke uitleg waarom het fout is
- **Reason field:** Specifiek en instructief (AI leert hiervan!)
- **Rating:** 5 voor perfecte voorbeelden, 4 voor goede maar niet ideale, 1-2 voor slechte voorbeelden

### Voorbeeld Bewerken

1. Klik **"Edit"** bij een voorbeeld
2. Pas **Content**, **Reason** of **Rating** aan (marketplace/type/category zijn locked)
3. Klik **"Opslaan"**

### Voorbeeld Verwijderen

1. Klik **"Delete"** bij een voorbeeld
2. Bevestig in popup

---

## Tab 2: Category Guidelines

### Guidelines Bekijken

**Filter:**
- **Filter by Customer:** Optioneel — filter op `bol_customer_id` (leeg = alle customers)

**Card weergave:**
- **Category Slug:** bijv. `sportlegging`, `laptops`
- **Category Name:** Leesbare naam (indien beschikbaar)
- **Focus Areas:** Belangrijkste content elementen voor deze categorie
- **Priority USPs:** Must-mention USPs voor deze categorie
- **Tone Guidelines:** Tone of voice instructies

### Guidelines Bewerken

1. Klik **"Edit"** bij een categorie
2. Pas velden aan:
   - **Content Focus Areas:** Komma-gescheiden lijst van focus areas (bijv. `kleur, maat, pasvorm, materiaal`)
   - **Tone Guidelines:** Vrije tekst met tone instructies (bijv. "Benadruk comfort en prestaties. Gebruik actieve taal.")
   - **Priority USPs:** Komma-gescheiden lijst van must-mention USPs (bijv. `ademend materiaal, perfecte pasvorm, duurzaam`)
   - **Attribute Templates:** JSON object met templates voor attribute formulering
     ```json
     {
       "Colour": "Verkrijgbaar in {value}",
       "Size Clothing": "Maat {value} - raadpleeg maattabel voor perfecte pasvorm"
     }
     ```
3. Klik **"Opslaan"**

**Voorbeelden per type:**

**Fashion (sportlegging, sport-bhs):**
- Focus Areas: `kleur, maat, pasvorm, materiaal, gebruik`
- Tone: "Benadruk comfort, prestaties en duurzaamheid. Gebruik actieve taal (hardlopen, yoga, fitness)."
- USPs: `ademend materiaal, perfecte pasvorm, vocht-afvoerend, high waist ondersteuning`

**Electronics (laptops, smartphones):**
- Focus Areas: `processor, RAM, opslag, schermgrootte, garantie, accu`
- Tone: "Technisch en informatief. Leg specs uit in begrijpelijke termen (bijv. '8GB RAM = soepel multitasken'). Vermeld praktisch gebruik."
- USPs: `snelle opstart (SSD), lange accu, Full HD scherm, lichtgewicht`

---

## Tab 3: Test Prompt

### Prompt Preview Testen

1. Vul **Test Category** in (bijv. `sportlegging`, `laptops`)
2. Klik **"Test"**
3. Bekijk resultaat:
   - **Examples die gebruikt zouden worden:** 2 good + 2 bad titles, 1 good + 1 bad description (gefilterd op category_slug)
   - **Category Guidelines die gebruikt zouden worden:** Focus areas, tone, USPs, templates

**Gebruik:**
- Verifieer dat de juiste examples worden opgehaald voor een categorie
- Check of category guidelines correct zijn ingesteld
- Test voordat je nieuwe content genereert met AI

---

## Hoe het werkt (Technical Flow)

### Content Generation Flow

```
User klikt "Genereer Content" in Bol Dashboard
    ↓
POST /api/bol-content-generate
    ↓
buildDatabasePrompt() [api/_lib/bol-content-prompt-builder.ts]
    ↓
├─ fetchCategoryExamples(category_slug)
│  └─ SELECT * FROM content_examples
│     WHERE marketplace='bol' AND category_slug='sportlegging'
│     ORDER BY rating DESC, usage_count DESC
│     LIMIT 2 (per type)
│
├─ Fetch category guidelines
│  └─ SELECT * FROM bol_category_attribute_requirements
│     WHERE category_slug='sportlegging'
│
└─ Build prompt:
   "## VOORBEELDEN VAN GOEDE/SLECHTE CONTENT
    ✅ GOEDE TITELS:
    - "Nike Dri-FIT Fast Sportlegging..."
      _Waarom: Merk + producttype + technologie..._

    ❌ SLECHTE TITELS (VERMIJD DIT):
    - "LEGGING SPORT ZWART..."
      _Waarom slecht: ALL CAPS, keyword stuffing..._

    ## CATEGORIE SPECIFIEKE RICHTLIJNEN (Sportlegging)
    Focus areas: kleur, maat, pasvorm, materiaal
    Tone: Benadruk comfort en prestaties
    Priority USPs: ademend materiaal, perfecte pasvorm
    ..."
```

### Waarom Examples Werken (Few-Shot Learning)

AI models leren beter van **concrete voorbeelden** dan van abstracte regels:

**Zonder examples:**
```
"Schrijf een goede titel voor bol.com"
→ Output: "Sportlegging Zwart M" (te kort, geen USP)
```

**Met examples:**
```
"GOEDE TITEL: Nike Dri-FIT Fast Sportlegging Dames - High Waist - Zwart - Maat M
 Waarom: Merk + producttype + technologie + doelgroep + USP + kleur + maat

 SLECHTE TITEL: LEGGING SPORT ZWART
 Waarom: ALL CAPS, geen merk, geen maat, geen USP

 Nu schrijf een titel voor product X"
→ Output: "Adidas Essentials Sportlegging Dames - 7/8 Lengte - Grijs - S - Comfort & Stretch"
```

AI imiteert de structuur van goede voorbeelden en vermijdt patronen van slechte voorbeelden.

---

## Tips & Best Practices

### Content Examples

✅ **DO:**
- Voeg 2-3 good + 2-3 bad examples toe per categorie
- Maak reason fields specifiek en instructief ("Waarom: Merk + model + USP + kleur + maat structuur")
- Gebruik diverse voorbeelden (verschillende merken, lengtes, stijlen)
- Rate beste voorbeelden met 5 sterren (worden eerst gekozen)
- Update examples als je merkt dat AI bepaalde fouten blijft maken

❌ **DON'T:**
- Teveel examples toevoegen (max 5 per type, anders prompt te lang)
- Vage reason fields ("Dit is goed" — leg uit WAAROM het goed is)
- Alleen goede examples toevoegen (slechte voorbeelden leren AI wat te vermijden)
- Outdated examples laten staan (verwijder als Bol.com regels veranderen)

### Category Guidelines

✅ **DO:**
- Definieer focus areas voor elke belangrijke categorie (fashion vs. electronics zijn HEEL verschillend)
- Maak tone guidelines actionable ("Gebruik actieve taal" is beter dan "Wees enthousiast")
- Prioriteer 3-5 USPs die echt belangrijk zijn voor conversie
- Test prompt preview voordat je content genereert

❌ **DON'T:**
- Generieke guidelines gebruiken voor alle categories (fashion heeft andere focus dan electronics)
- Te veel USPs toevoegen (AI kan niet 15 USPs in 1 titel verwerken)
- Attribute templates weglaten (AI weet vaak niet hoe attributen te formuleren)

### Testing

1. **Na het toevoegen van nieuwe examples:**
   - Ga naar Test tab → vul category in → check of examples worden opgehaald
   - Genereer test content voor die categorie → check of AI de patronen volgt

2. **Na het updaten van guidelines:**
   - Ga naar Test tab → check of guidelines correct worden getoond
   - Vergelijk oude vs. nieuwe content → check of tone/focus is veranderd

3. **Monitoring:**
   - Check `usage_count` in examples tabel (welke examples worden veel gebruikt?)
   - Analyseer gegenereerde content → welke patterns werken goed?
   - Update/verwijder examples die niet effectief blijken

---

## Troubleshooting

### "Geen voorbeelden gevonden"
- **Check:** Is de category slug correct gespeld? (lowercase, hyphens niet spaties)
- **Fix:** Voeg examples toe voor deze categorie OF gebruik generic examples (category_slug = NULL)

### "Guidelines niet zichtbaar in Test tab"
- **Check:** Is de category_slug exact hetzelfde als in `bol_category_attribute_requirements` tabel?
- **Fix:** Run `SELECT DISTINCT category_slug FROM bol_category_attribute_requirements` en gebruik exact die spelling

### "AI genereert nog steeds slechte content"
- **Check:** Zijn de examples specifiek genoeg? Is de reason field instructief?
- **Fix:** Voeg meer concrete voorbeelden toe met gedetailleerde reason uitleg
- **Check:** Zijn de category guidelines ingesteld?
- **Fix:** Definieer focus areas en tone voor deze categorie

### "TypeError: Cannot read property 'content_focus_areas'"
- **Check:** Zijn de migraties correct uitgevoerd?
- **Fix:** Run migration 027 opnieuw in Supabase SQL editor

### "401 Unauthorized" bij API calls
- **Check:** Is de Supabase auth token nog geldig?
- **Fix:** Log opnieuw in via Google OAuth

---

## Volgende Stappen (Future Enhancements)

### Phase 3: Usage Tracking
- Increment `usage_count` na elke content generation
- Track welke examples leiden tot approved content (effectiveness score)
- Auto-prioritize high-performing examples

### Phase 4: A/B Testing
- Test verschillende example sets (welke leiden tot betere content?)
- Compare performance metrics (CTR, conversie) tussen example sets

### Phase 5: Amazon Expansion
- Voeg Amazon-specifieke examples toe (marketplace='amazon', language='en')
- Definieer Amazon category guidelines (andere regels dan Bol.com)
- Reuse dezelfde admin UI voor multi-marketplace beheer

---

## Support

**Issues?** Check:
1. Browser console voor frontend errors
2. Vercel logs voor backend errors (`vercel logs`)
3. Supabase logs voor database errors

**Contact:** Ping Claude Code met specifieke error messages + screenshots
