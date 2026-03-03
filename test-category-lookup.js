/**
 * Test: Haal category ID op voor één van onze eigen producten
 * en test of /products/list werkt met die category ID
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

async function getProductRanks(token, ean, date) {
  const params = new URLSearchParams({ ean, date, type: 'BROWSE', page: '1' });
  const res = await fetch(`https://api.bol.com/retailer/insights/product-ranks?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl-NL',
    },
  });
  if (!res.ok) throw new Error(`getProductRanks failed: ${res.status}`);
  const data = await res.json();
  return data.ranks || [];
}

async function testProductsList(token, categoryId) {
  console.log(`\n🔍 Testing /products/list met category ${categoryId}...\n`);

  const res = await fetch('https://api.bol.com/retailer/products/list', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Content-Type': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl-NL',
    },
    body: JSON.stringify({
      countryCode: 'NL',
      categoryId: categoryId,
      sort: 'POPULARITY',
      page: 1,
    }),
  });

  console.log(`Response status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Error:\n${text}`);
    return false;
  }

  const data = await res.json();
  console.log(`✅ Success! ${data.products?.length || 0} producten gevonden`);

  // Toon eerste 3 producten
  (data.products || []).slice(0, 3).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.title} (EAN: ${p.eans?.[0]?.ean || 'n/a'})`);
  });

  return true;
}

async function main() {
  console.log('🏪 Ophalen FashionPower gegevens...');

  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  if (!customer) {
    console.error('❌ Customer niet gevonden');
    return;
  }

  console.log(`✅ Customer: ${customer.seller_name}`);

  console.log('\n🔐 Access token ophalen...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  console.log('✅ Token verkregen');

  // Haal één eigen product op met category_id
  console.log('\n📦 Ophalen eigen product met category_id...');
  const { data: products } = await supabase
    .from('bol_product_categories')
    .select('ean, category_id, category_name')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(1);

  if (!products || products.length === 0) {
    console.error('❌ Geen producten met category_id gevonden');
    return;
  }

  const testProduct = products[0];
  console.log(`✅ Test product: EAN ${testProduct.ean}`);
  console.log(`   Category ID: ${testProduct.category_id}`);
  console.log(`   Category Name: ${testProduct.category_name || 'null'}`);

  // Test 1: Verificatie via product-ranks
  console.log('\n📊 STAP 1: Verificatie via /product-ranks API...');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  const ranks = await getProductRanks(token, testProduct.ean, dateStr);
  console.log(`✅ ${ranks.length} ranks gevonden`);

  if (ranks.length > 0) {
    const topRank = ranks[0];
    console.log(`   Top rank category ID: ${topRank.categoryId}`);
    console.log(`   Impressions: ${topRank.impressions}`);
  }

  // Test 2: Probeer products/list met deze category ID
  console.log('\n🧪 STAP 2: Test /products/list met deze category ID...');
  const success = await testProductsList(token, testProduct.category_id);

  console.log('\n' + '='.repeat(60));
  if (success) {
    console.log('✅ CONCLUSIE: Category ID werkt met /products/list!');
    console.log('   → De implementatie is correct');
    console.log('   → Probleem moet ergens anders zitten');
  } else {
    console.log('❌ CONCLUSIE: Category ID werkt NIET met /products/list');
    console.log('   → Category IDs van /product-ranks zijn incompatibel');
    console.log('   → We moeten category IDs uit de category tree halen');
  }
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
