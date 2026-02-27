#!/usr/bin/env node
/**
 * Check if there's ANY November 2025 data in the database
 */

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

async function main() {
  console.log('🔍 Searching for November 2025 data in database...\n');

  // Query for rows with period dates in November 2025
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bol_campaign_performance?bol_customer_id=eq.${CUSTOMER_ID}&period_start_date=gte.2025-11-01&period_end_date=lte.2025-11-30&select=period_start_date,period_end_date,campaign_name,spend,revenue`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    console.error('❌ Query failed:', await res.text());
    process.exit(1);
  }

  const rows = await res.json();
  console.log(`Found ${rows.length} rows with November 2025 data\n`);

  if (rows.length === 0) {
    console.log('❌ NO November 2025 data exists in the database!');
    console.log('\nThis is why the dashboard shows no data when you select Nov 1-27.');
    console.log('\n📊 What data DO we have?');

    // Show what data exists
    const allRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bol_campaign_performance?bol_customer_id=eq.${CUSTOMER_ID}&select=period_start_date,period_end_date&order=period_start_date.asc`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const allRows = await allRes.json();
    const uniqueDates = [...new Set(allRows.map(r => `${r.period_start_date} to ${r.period_end_date}`))];
    console.log(`\nAll unique period ranges in DB (${uniqueDates.length}):`);
    uniqueDates.forEach(range => {
      const count = allRows.filter(r => `${r.period_start_date} to ${r.period_end_date}` === range).length;
      console.log(`  ${range} (${count} campaigns)`);
    });

    console.log('\n💡 The Bol.com Advertising API was called with dateFrom/dateTo parameters,');
    console.log('   but historical data is NOT fetched automatically.');
    console.log('\n   The sync currently fetches:');
    console.log('   - First sync: last 180 days');
    console.log('   - Incremental syncs: last 7 days');
    console.log('\n   Since the first sync ran on Feb 26-27, 2026, it fetched data from');
    console.log('   Aug 31, 2025 onwards. But Bol.com only had data from Feb 20-27.');
  } else {
    console.log('✅ November 2025 data EXISTS!');
    rows.forEach(row => {
      console.log(`  ${row.period_start_date} to ${row.period_end_date}: ${row.campaign_name} - €${row.spend} spend`);
    });
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
