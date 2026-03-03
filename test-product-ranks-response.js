/**
 * Test: Bekijk de exacte response van product-ranks API
 * om te zien waar categoryId vandaan komt
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getBolToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://login.bol.com/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function main() {
  console.log('🏪 Ophalen customer...');
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  console.log(`✅ ${customer.seller_name}`);

  console.log('\n🔐 Access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Haal een test EAN op
  const { data: products } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .limit(1);

  const testEan = products[0].ean;

  console.log(`\n📦 Test EAN: ${testEan}`);

  // Call product-ranks API
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`\n🔍 API Call: GET /retailer/insights/product-ranks`);
  console.log(`   Parameters:`);
  console.log(`   - ean: ${testEan}`);
  console.log(`   - date: ${dateStr}`);
  console.log(`   - type: BROWSE`);
  console.log(`   - page: 1`);

  const params = new URLSearchParams({
    ean: testEan,
    date: dateStr,
    type: 'BROWSE',
    page: '1',
  });

  const res = await fetch(`https://api.bol.com/retailer/insights/product-ranks?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl-NL',
    },
  });

  console.log(`\n📡 Response status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Error: ${text}`);
    return;
  }

  const data = await res.json();

  console.log(`\n✅ Response ontvangen!`);
  console.log(`\n📋 Volledige response structure:\n`);
  console.log(JSON.stringify(data, null, 2));

  if (data.ranks && data.ranks.length > 0) {
    console.log(`\n📊 Eerste rank entry gedetailleerd:\n`);
    const firstRank = data.ranks[0];

    console.log(`categoryId: "${firstRank.categoryId}" (type: ${typeof firstRank.categoryId})`);
    console.log(`searchTerm: "${firstRank.searchTerm}"`);
    console.log(`rank: ${firstRank.rank}`);
    console.log(`impressions: ${firstRank.impressions}`);
    console.log(`wasSponsored: ${firstRank.wasSponsored}`);

    console.log(`\n💡 Dit is de categoryId die we opslaan in bol_product_categories!`);
    console.log(`   Deze ID (${firstRank.categoryId}) is een RANKING category ID`);
    console.log(`   NIET compatibel met /products/list API`);
  } else {
    console.log(`\n⚠️  Geen ranks gevonden voor dit product`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSIE:');
  console.log('De categoryId komt van: /retailer/insights/product-ranks');
  console.log('Dit is een RANKING category (analytics/tracking systeem)');
  console.log('NIET hetzelfde als CATALOG category (browse/verkoop systeem)');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
