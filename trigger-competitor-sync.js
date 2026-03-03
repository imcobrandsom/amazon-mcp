/**
 * Trigger competitor analysis sync manually
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzgyOTMsImV4cCI6MjA4NzYxNDI5M30.AV6fOrwRYSCMJU__u_4FQSNcLoPcXDh8OOqoHGNaLi4';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

// You'll need to get this from your Supabase session
// For now, we'll use the service key approach via API

async function triggerSync() {
  console.log('🚀 Triggering competitor analysis sync...\n');
  console.log('='.repeat(80));

  // Call the local/deployed API endpoint
  const apiUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/bol-sync-trigger`
    : 'http://localhost:3000/api/bol-sync-trigger';

  console.log(`\nAPI endpoint: ${apiUrl}`);
  console.log(`Customer ID: ${CUSTOMER_ID}`);
  console.log(`Sync type: competitor\n`);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-call': 'true', // Bypass auth for internal calls
      },
      body: JSON.stringify({
        customerId: CUSTOMER_ID,
        syncType: 'competitor',
      }),
    });

    console.log(`Response status: ${res.status}\n`);

    if (!res.ok) {
      const error = await res.text();
      console.log(`❌ Error: ${error}\n`);
      return;
    }

    const data = await res.json();
    console.log('✅ Sync triggered successfully!\n');
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n' + '='.repeat(80));
    console.log('\n💡 The competitor analysis is now running.');
    console.log('   This may take 10-20 minutes depending on the number of categories.');
    console.log('   Check the logs or database for progress.\n');

  } catch (err) {
    console.log(`❌ Error: ${err.message}\n`);
  }

  console.log('='.repeat(80) + '\n');
}

triggerSync().catch(console.error);
