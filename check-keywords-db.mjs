import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ioipgwwbxxeyhthfislc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI'
);

const customerId = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

console.log('🔍 Checking keywords in database...\n');

const { count, error } = await supabase
  .from('bol_product_keyword_targets')
  .select('*', { count: 'exact', head: true })
  .eq('bol_customer_id', customerId);

console.log(`Total keywords: ${count || 0}`);

if (count > 0) {
  // Get sample by source
  const { data: samples } = await supabase
    .from('bol_product_keyword_targets')
    .select('source, keyword, ean, priority, created_at')
    .eq('bol_customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n📋 Recent keywords by source:');
  const bySource = {};
  for (const kw of samples || []) {
    if (!bySource[kw.source]) bySource[kw.source] = [];
    bySource[kw.source].push(kw);
  }

  for (const [source, kws] of Object.entries(bySource)) {
    console.log(`\n  ${source}: ${kws.length} samples`);
    kws.slice(0, 3).forEach(kw => {
      console.log(`    - "${kw.keyword}" (priority: ${kw.priority}, created: ${kw.created_at})`);
    });
  }

  // Count by source
  const { data: counts } = await supabase
    .from('bol_product_keyword_targets')
    .select('source')
    .eq('bol_customer_id', customerId);

  const sourceCounts = {};
  for (const row of counts || []) {
    sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
  }

  console.log('\n📊 Keywords by source:');
  for (const [source, count] of Object.entries(sourceCounts)) {
    console.log(`  ${source}: ${count}`);
  }
}

console.log('\n✅ Done');
