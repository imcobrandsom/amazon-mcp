/**
 * Manually trigger extended sync to populate competitor data
 * Usage: node trigger-extended-sync.js
 */

import 'dotenv/config';

const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
const BASE_URL = process.env.VITE_API_URL || 'https://amazon-mcp-eight.vercel.app';

async function main() {
  console.log('🔄 Triggering Extended Sync...\n');

  // Try with CRON_SECRET first
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.log('❌ CRON_SECRET not set in environment');
    console.log('\nPlease either:');
    console.log('  1. Click the "Extended Data" button in the dashboard, OR');
    console.log('  2. Set CRON_SECRET in .env.local and re-run this script\n');
    process.exit(1);
  }

  try {
    const response = await fetch(`${BASE_URL}/api/bol-sync-extended`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.log('❌ Error:', data.error || response.statusText);
      console.log('\nResponse:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ Extended sync triggered successfully!\n');
    console.log('Results:', JSON.stringify(data, null, 2));

    console.log('\n⏳ Waiting 10 seconds for sync to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check results
    console.log('\n🔍 Checking competitor snapshots count...');
    const diagnosticResponse = await fetch(
      `${BASE_URL}/api/bol-sync-diagnostic?customerId=${CUSTOMER_ID}`
    );
    const diagnostic = await diagnosticResponse.json();

    const count = diagnostic.checks?.competitor_snapshots?.count || 0;
    console.log(`\nCompetitor snapshots in database: ${count}`);

    if (count > 0) {
      console.log('✅ Success! Competitor data populated.');
    } else {
      console.log('⚠️  No competitor data yet. Check the sync results above for errors.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
