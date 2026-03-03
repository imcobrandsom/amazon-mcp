/**
 * Check what's in bol_competitor_catalog and why it's only 50 records
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('🔍 Checking bol_competitor_catalog...\n');

  // Total count
  const { count: totalCount } = await supabase
    .from('bol_competitor_catalog')
    .select('*', { count: 'exact', head: true })
    .eq('bol_customer_id', CUSTOMER_ID);

  console.log(`Total records: ${totalCount || 0}\n`);

  // Group by category
  const { data: allRecords } = await supabase
    .from('bol_competitor_catalog')
    .select('category_slug, category_id, competitor_ean, fetched_at')
    .eq('bol_customer_id', CUSTOMER_ID);

  const byCategory = new Map();

  for (const record of allRecords || []) {
    const key = record.category_slug || 'unknown';
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        slug: key,
        id: record.category_id,
        count: 0,
        eans: new Set(),
        latestFetch: record.fetched_at,
      });
    }
    const cat = byCategory.get(key);
    cat.count++;
    cat.eans.add(record.competitor_ean);
    if (record.fetched_at > cat.latestFetch) {
      cat.latestFetch = record.fetched_at;
    }
  }

  console.log('📊 Records by category:\n');
  for (const [slug, info] of byCategory.entries()) {
    console.log(`${slug} (${info.id}):`);
    console.log(`  - ${info.count} records`);
    console.log(`  - ${info.eans.size} unique EANs`);
    console.log(`  - Latest: ${info.latestFetch}`);
    console.log('');
  }

  // Check for duplicates
  const eanCounts = new Map();
  for (const record of allRecords || []) {
    const key = `${record.category_slug}:${record.competitor_ean}`;
    eanCounts.set(key, (eanCounts.get(key) || 0) + 1);
  }

  const duplicates = Array.from(eanCounts.entries()).filter(([_, count]) => count > 1);

  if (duplicates.length > 0) {
    console.log(`⚠️  Found ${duplicates.length} duplicate EAN+category combinations:\n`);
    duplicates.slice(0, 5).forEach(([key, count]) => {
      console.log(`  ${key}: ${count} times`);
    });
    if (duplicates.length > 5) {
      console.log(`  ... and ${duplicates.length - 5} more`);
    }
    console.log('');
  }

  // Check unique constraint
  console.log('🔍 Checking if UNIQUE constraint exists...\n');

  // Try inserting a duplicate
  const firstRecord = allRecords?.[0];
  if (firstRecord) {
    console.log(`Testing duplicate insert for: ${firstRecord.competitor_ean} in ${firstRecord.category_slug}\n`);

    const { error } = await supabase
      .from('bol_competitor_catalog')
      .insert({
        bol_customer_id: CUSTOMER_ID,
        competitor_ean: firstRecord.competitor_ean,
        category_slug: firstRecord.category_slug,
        category_id: firstRecord.category_id,
        title: 'TEST DUPLICATE',
        fetched_at: new Date().toISOString(),
      });

    if (error) {
      console.log(`✅ UNIQUE constraint is working (error: ${error.message})\n`);
    } else {
      console.log(`❌ NO UNIQUE constraint! Duplicate was inserted!\n`);

      // Delete the test record
      await supabase
        .from('bol_competitor_catalog')
        .delete()
        .eq('title', 'TEST DUPLICATE');
    }
  }

  console.log('💡 Analysis:\n');

  if (totalCount === 50) {
    console.log('❌ Only 50 records - this suggests:');
    console.log('   1. Only 1 page of /products/list was processed');
    console.log('   2. OR the limit(50) on content enrichment is affecting catalog insert');
    console.log('   3. OR there\'s a database constraint preventing inserts\n');
  } else if (totalCount === 500) {
    console.log('✅ 500 records from our local test are still there');
    console.log('   But new API runs are not adding more data\n');
  }
}

main().catch(console.error);
