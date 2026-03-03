#!/usr/bin/env tsx
/**
 * Seeds academy_articles table from public/academy-articles.json
 * Usage: npx tsx scripts/seed-academy-articles.ts
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
config({ path: '.env.local' });

interface JsonArticle {
  title: string;
  subtitle: string;
  slug: string;
  category: string;
  subcategory: string;
  keywords: string;
  body: string;
  lastModified: string;
}

async function main() {
  // Load env
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load JSON
  const json = readFileSync('public/academy-articles.json', 'utf-8');
  const articles: JsonArticle[] = JSON.parse(json);

  console.log(`Loaded ${articles.length} articles from JSON`);

  // Check if already seeded
  const { count } = await supabase
    .from('academy_articles')
    .select('*', { count: 'exact', head: true });

  if (count && count > 0) {
    console.log(`⚠️  Table already has ${count} articles. Skipping seed.`);
    console.log('If you want to re-seed, truncate the table first:');
    console.log('  psql -c "TRUNCATE academy_articles CASCADE;"');
    return;
  }

  // Transform and insert
  const rows = articles.map(a => {
    // Parse date safely
    let lastModifiedDate = null;
    if (a.lastModified && a.lastModified.trim() !== '') {
      try {
        const parsed = new Date(a.lastModified);
        if (!isNaN(parsed.getTime())) {
          lastModifiedDate = parsed.toISOString();
        }
      } catch (e) {
        // Skip invalid dates
      }
    }

    return {
      title: a.title,
      subtitle: a.subtitle || null,
      slug: a.slug,
      category: a.category || 'Overig',
      subcategory: a.subcategory || null,
      keywords: a.keywords || null,
      body: a.body,
      last_modified_date: lastModifiedDate,
      is_published: true,
    };
  });

  // Insert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('academy_articles').insert(batch);

    if (error) {
      console.error(`Error inserting batch ${i}-${i + batch.length}:`, error);
      process.exit(1);
    }

    console.log(`Inserted ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }

  console.log('✅ Seed complete!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
