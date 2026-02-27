#!/usr/bin/env node
/**
 * Debug API calls to understand what's being returned
 */

const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

async function testAPI(from, to, label) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${label}`);
  console.log(`Date range: ${from} to ${to}`);
  console.log('='.repeat(80));

  // Test chart API
  const chartUrl = `https://amazon-mcp-eight.vercel.app/api/bol-campaigns-chart?customerId=${CUSTOMER_ID}&from=${from}&to=${to}`;
  console.log(`\n📊 Chart API: ${chartUrl}`);

  const chartRes = await fetch(chartUrl);
  if (!chartRes.ok) {
    console.error('❌ Chart API failed:', chartRes.status, await chartRes.text());
  } else {
    const chartData = await chartRes.json();
    console.log(`   Points: ${chartData.points?.length ?? 0}`);
    if (chartData.points?.length > 0) {
      const totals = chartData.points.reduce((acc, p) => ({
        spend: acc.spend + (p.spend ?? 0),
        revenue: acc.revenue + (p.revenue ?? 0),
        clicks: acc.clicks + (p.clicks ?? 0),
      }), { spend: 0, revenue: 0, clicks: 0 });
      console.log(`   Total Spend: €${totals.spend.toFixed(2)}`);
      console.log(`   Total Revenue: €${totals.revenue.toFixed(2)}`);
      console.log(`   ROAS: ${totals.spend > 0 ? (totals.revenue / totals.spend).toFixed(2) : 0}×`);
      console.log(`   Dates: ${chartData.points[0].date} to ${chartData.points[chartData.points.length - 1].date}`);
    }
  }

  // Test campaigns API
  const campUrl = `https://amazon-mcp-eight.vercel.app/api/bol-campaigns?customerId=${CUSTOMER_ID}&from=${from}&to=${to}`;
  console.log(`\n📋 Campaigns API: ${campUrl}`);

  const campRes = await fetch(campUrl);
  if (!campRes.ok) {
    console.error('❌ Campaigns API failed:', campRes.status, await campRes.text());
  } else {
    const campData = await campRes.json();
    console.log(`   Campaigns: ${campData.campaigns?.length ?? 0}`);
    console.log(`   Keywords: ${campData.keywords?.length ?? 0}`);

    if (campData.campaigns?.length > 0) {
      const totals = campData.campaigns.reduce((acc, c) => ({
        spend: acc.spend + (c.spend ?? 0),
        revenue: acc.revenue + (c.revenue ?? 0),
      }), { spend: 0, revenue: 0 });
      console.log(`   Total Spend: €${totals.spend.toFixed(2)}`);
      console.log(`   Total Revenue: €${totals.revenue.toFixed(2)}`);
    }
  }
}

async function main() {
  console.log('🔍 Debugging API calls with different date ranges...\n');

  // Test 1: Jan 28 - Feb 27 (what the screenshot shows)
  await testAPI('2026-01-28', '2026-02-27', 'Jan 28 - Feb 27, 2026 (from screenshot)');

  // Test 2: Nov 1 - Nov 27 (first screenshot)
  await testAPI('2025-11-01', '2025-11-27', 'Nov 1-27, 2025 (first screenshot)');

  // Test 3: Feb 20-27 (actual data range in DB)
  await testAPI('2026-02-20', '2026-02-27', 'Feb 20-27, 2026 (actual DB data)');

  // Test 4: No date range (default)
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: No date range (latest snapshot)`);
  console.log('='.repeat(80));

  const defaultUrl = `https://amazon-mcp-eight.vercel.app/api/bol-campaigns?customerId=${CUSTOMER_ID}`;
  console.log(`\n📋 Campaigns API: ${defaultUrl}`);

  const defaultRes = await fetch(defaultUrl);
  if (!defaultRes.ok) {
    console.error('❌ API failed:', defaultRes.status, await defaultRes.text());
  } else {
    const defaultData = await defaultRes.json();
    console.log(`   Campaigns: ${defaultData.campaigns?.length ?? 0}`);
    console.log(`   Keywords: ${defaultData.keywords?.length ?? 0}`);

    if (defaultData.campaigns?.length > 0) {
      const totals = defaultData.campaigns.reduce((acc, c) => ({
        spend: acc.spend + (c.spend ?? 0),
        revenue: acc.revenue + (c.revenue ?? 0),
      }), { spend: 0, revenue: 0 });
      console.log(`   Total Spend: €${totals.spend.toFixed(2)}`);
      console.log(`   Total Revenue: €${totals.revenue.toFixed(2)}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
