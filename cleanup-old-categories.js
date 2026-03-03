/**
 * Cleanup: Remove old ranking category IDs (8-digit) from database
 * These are incompatible with /products/list API
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('🧹 CLEANUP: Removing old ranking category IDs\n');
  console.log('='.repeat(80));

  // 1. Check current state
  console.log('\n1️⃣ Current state:\n');
  const { data: allCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  const uniqueCategories = new Map();
  for (const cat of allCategories || []) {
    uniqueCategories.set(cat.category_id, cat.category_name);
  }

  console.log(`   Total rows: ${allCategories?.length || 0}`);
  console.log(`   Unique categories: ${uniqueCategories.size}\n`);

  // Identify old ranking IDs (8+ digits or starting with 3000/8000)
  const oldIds = [];
  const newIds = [];

  for (const [id, name] of uniqueCategories.entries()) {
    if (id.length >= 8 || id.startsWith('3000') || id.startsWith('8000')) {
      oldIds.push({ id, name });
    } else {
      newIds.push({ id, name });
    }
  }

  console.log(`   📊 Breakdown:`);
  console.log(`      ✅ New catalog IDs (5-digit): ${newIds.length}`);
  console.log(`      ❌ Old ranking IDs (8-digit): ${oldIds.length}\n`);

  if (oldIds.length > 0) {
    console.log(`   Old ranking IDs to remove:`);
    for (const { id, name } of oldIds.slice(0, 5)) {
      console.log(`      - ${id} (${name || 'NULL'})`);
    }
    if (oldIds.length > 5) {
      console.log(`      ... and ${oldIds.length - 5} more`);
    }
    console.log('');
  }

  // 2. Delete old ranking category IDs
  if (oldIds.length > 0) {
    console.log('2️⃣ Deleting old ranking category IDs...\n');

    const oldIdStrings = oldIds.map(({ id }) => id);

    const { error, count } = await supabase
      .from('bol_product_categories')
      .delete({ count: 'exact' })
      .eq('bol_customer_id', CUSTOMER_ID)
      .in('category_id', oldIdStrings);

    if (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    } else {
      console.log(`   ✅ Deleted ${count} rows with old ranking IDs\n`);
    }
  } else {
    console.log('2️⃣ No old ranking IDs found - database is clean! ✅\n');
  }

  // 3. Verify final state
  console.log('3️⃣ Final state:\n');
  const { data: finalCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  const finalUnique = new Map();
  for (const cat of finalCategories || []) {
    finalUnique.set(cat.category_id, cat.category_name);
  }

  console.log(`   Total rows: ${finalCategories?.length || 0}`);
  console.log(`   Unique categories: ${finalUnique.size}\n`);

  // Check if any old IDs remain
  const remainingOld = [];
  for (const [id] of finalUnique.entries()) {
    if (id.length >= 8 || id.startsWith('3000') || id.startsWith('8000')) {
      remainingOld.push(id);
    }
  }

  if (remainingOld.length > 0) {
    console.log(`   ⚠️  Still ${remainingOld.length} old IDs remaining\n`);
  } else {
    console.log(`   ✅ All category IDs are now valid catalog IDs!\n`);
  }

  console.log('='.repeat(80));
  console.log('\n💡 NEXT STEP: Trigger extended sync to repopulate with new placement API\n');
  console.log('   This will fetch catalog category IDs via /products/{ean}/placement\n');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
