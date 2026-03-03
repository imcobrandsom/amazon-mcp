/**
 * Check if bol_competitor_snapshots has EANs for competitor analysis to use
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('📦 Checking bol_competitor_snapshots for EANs...\n');

  const { data: snapshots, error } = await supabase
    .from('bol_competitor_snapshots')
    .select('ean, fetched_at')
    .eq('bol_customer_id', CUSTOMER_ID)
    .order('fetched_at', { ascending: false })
    .limit(200);

  if (error) {
    console.log(`❌ Error: ${error.message}\n`);
    return;
  }

  if (!snapshots || snapshots.length === 0) {
    console.log('❌ NO DATA in bol_competitor_snapshots!\n');
    console.log('💡 This is WHY competitor analysis fails:');
    console.log('   The code expects EANs from bol_competitor_snapshots (line 123)');
    console.log('   But this table is EMPTY!\n');
    console.log('🔧 FIX: Run Extended Sync first to populate bol_competitor_snapshots\n');
    return;
  }

  console.log(`✅ Found ${snapshots.length} snapshots\n`);

  const uniqueEans = [...new Set(snapshots.map(s => s.ean).filter(Boolean))];
  console.log(`📊 Unique EANs: ${uniqueEans.length}`);
  console.log(`📅 Latest fetch: ${snapshots[0]?.fetched_at}\n`);

  console.log('Sample EANs:');
  uniqueEans.slice(0, 5).forEach(ean => console.log(`   - ${ean}`));
  console.log('');
}

main().catch(console.error);
