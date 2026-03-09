// Test direct database insert to isolate the issue
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ioipgwwbxxeyhthfislc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI'
);

const customerId = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

console.log('🧪 Testing direct insert to bol_product_keyword_targets...\n');

// Test 1: Simple insert
const testKeyword = {
  bol_customer_id: customerId,
  ean: '8720701638082',
  keyword: 'test sportlegging',
  priority: 5,
  source: 'test_manual',
};

console.log('Test 1: Single insert');
const { data: insertData, error: insertErr } = await supabase
  .from('bol_product_keyword_targets')
  .insert(testKeyword)
  .select();

if (insertErr) {
  console.log('  ❌ Error:', insertErr.message);
  console.log('  Code:', insertErr.code);
  console.log('  Details:', insertErr.details);
  console.log('  Hint:', insertErr.hint);
} else {
  console.log('  ✅ Success! Inserted:', insertData);
}

// Test 2: Upsert (same as enrichment code)
console.log('\nTest 2: Upsert with onConflict');
const testKeyword2 = {
  bol_customer_id: customerId,
  ean: '8720701638082',
  keyword: 'sportlegging dames',
  priority: 9,
  source: 'category_analysis',
};

const { data: upsertData, error: upsertErr, count } = await supabase
  .from('bol_product_keyword_targets')
  .upsert(testKeyword2, {
    onConflict: 'bol_customer_id,ean,keyword',
    ignoreDuplicates: false,
  })
  .select('id', { count: 'exact', head: true });

if (upsertErr) {
  console.log('  ❌ Error:', upsertErr.message);
  console.log('  Code:', upsertErr.code);
} else {
  console.log(`  ✅ Success! Count: ${count}`);
}

// Check total
const { count: totalCount } = await supabase
  .from('bol_product_keyword_targets')
  .select('*', { count: 'exact', head: true })
  .eq('bol_customer_id', customerId);

console.log(`\n📊 Total keywords in DB: ${totalCount}`);

// Cleanup
console.log('\n🧹 Cleaning up test keywords...');
const { error: delErr } = await supabase
  .from('bol_product_keyword_targets')
  .delete()
  .eq('source', 'test_manual');

if (delErr) console.log('  ❌ Cleanup error:', delErr.message);
else console.log('  ✅ Cleanup done');
