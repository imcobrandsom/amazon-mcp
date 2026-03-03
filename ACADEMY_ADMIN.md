# Academy Admin Functionaliteit

## Overzicht

Admins kunnen Academy-artikelen bewerken, verwijderen en nieuwe artikelen aanmaken via de UI.

## Setup (eenmalig)

### 1. Run de migratie

```bash
# Via Supabase Dashboard SQL editor:
# - Open https://supabase.com/dashboard/project/[jouw-project]/sql
# - Plak de inhoud van supabase/migrations/013_academy_articles.sql
# - Run query
```

### 2. Seed de database

```bash
# Lokaal (met .env.local):
npx tsx scripts/seed-academy-articles.ts

# Of via productie (met SUPABASE_URL en SUPABASE_SERVICE_KEY env vars):
SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx npx tsx scripts/seed-academy-articles.ts
```

Dit importeert de 525 artikelen uit `public/academy-articles.json` naar de database.

**Let op:** Het script controleert of de tabel al data bevat en skip dan de seed.
Als je opnieuw wilt seeden, truncate eerst de tabel:

```sql
TRUNCATE academy_articles CASCADE;
```

## Admin functies

### Als admin ingelogd:

1. **Nieuwe artikel aanmaken**
   - Klik op de `+` knop in de sidebar header
   - Vul alle velden in (titel, slug, categorie, body HTML)
   - Klik "Opslaan"

2. **Artikel bewerken**
   - Open een artikel
   - Klik "Bewerken" bovenaan
   - Pas velden aan
   - Klik "Opslaan"

3. **Artikel verwijderen**
   - Open een artikel
   - Klik "Verwijderen" bovenaan
   - Bevestig de actie

4. **Unpublished artikelen**
   - Admins zien alle artikelen (ook unpublished)
   - Niet-admins zien alleen `is_published = true` artikelen
   - Unpublished artikelen hebben een oranje "Concept" label

## API Endpoints

```
GET    /api/academy-articles      - List articles (all for admins, published for others)
POST   /api/academy-articles      - Create article (admin only)
PUT    /api/academy-articles      - Update article (admin only)
DELETE /api/academy-articles?id=  - Delete article (admin only)
```

Auth: Alle mutaties vereisen `Authorization: Bearer <supabase-token>` + admin role.

## Database Schema

```sql
academy_articles (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT UNIQUE NOT NULL,  -- e.g. "strategy/marketing-plan/title"
  category TEXT NOT NULL,
  subcategory TEXT,
  keywords TEXT,
  body TEXT NOT NULL,         -- HTML
  last_modified_date TIMESTAMPTZ,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
)
```

## RLS Policies

- **SELECT**: Iedereen kan gepubliceerde artikelen zien
- **INSERT/UPDATE/DELETE**: Alleen admins (via `user_roles.role = 'admin'` check)

## Frontend Flow

1. **Pagina load**: `fetchAcademyArticles()` → GET `/api/academy-articles`
   - Geeft alle artikelen voor admins, alleen published voor anderen

2. **Create**: Admin klikt `+` → modal → `createAcademyArticle()` → POST

3. **Update**: Admin klikt "Bewerken" → modal → `updateAcademyArticle()` → PUT

4. **Delete**: Admin klikt "Verwijderen" → confirm → `deleteAcademyArticle()` → DELETE

## Migration van JSON naar DB

De oude `public/academy-articles.json` blijft bestaan als backup, maar wordt niet meer gebruikt.
De frontend haalt nu alles uit de database via de API.

Als je de JSON opnieuw wilt importeren:
```bash
# 1. Truncate de tabel
psql "postgresql://..." -c "TRUNCATE academy_articles CASCADE;"

# 2. Re-seed
npx tsx scripts/seed-academy-articles.ts
```

## Troubleshooting

### "Kon artikelen niet laden"
- Check of de migratie is gerunned
- Check of de seed is gedaan
- Check Supabase logs voor RLS policy errors

### "Admin access required"
- Check of je user een `user_roles` record heeft met `role = 'admin'`
- Check of je ingelogd bent (Authorization header aanwezig)

### Slug conflicts
- Slugs moeten uniek zijn
- Gebruik alleen lowercase, cijfers, `-` en `/`
- Formaat: `category/subcategory/title-slug`
