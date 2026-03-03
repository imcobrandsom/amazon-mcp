/**
 * Test script voor /retailer/products/list endpoint
 *
 * Run met: node test-products-list.js
 *
 * Test of deze API concurrenten retourneert of alleen eigen producten
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getBolToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://login.bol.com/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function testProductsList(token, categoryId, yourEans = []) {
  console.log(`\n🔍 Testing /retailer/products/list voor category ${categoryId}...\n`);

  const res = await fetch('https://api.bol.com/retailer/products/list', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Content-Type': 'application/vnd.retailer.v10+json',
    },
    body: JSON.stringify({
      countryCode: 'NL',
      categoryId: categoryId,
      sort: 'POPULARITY',
      page: 1,
    }),
  });

  if (!res.ok) {
    console.error(`❌ API Error: ${res.status}`);
    const text = await res.text();
    console.error(text);
    return;
  }

  const data = await res.json();
  const products = data.products || [];

  console.log(`✅ Response: ${products.length} producten gevonden\n`);

  // Analyseer de producten
  let ownProducts = 0;
  let competitorProducts = 0;
  let noEan = 0;

  products.slice(0, 10).forEach((product, i) => {
    const ean = product.eans?.[0]?.ean;
    const isOwn = ean && yourEans.includes(ean);

    if (!ean) noEan++;
    else if (isOwn) ownProducts++;
    else competitorProducts++;

    const marker = !ean ? '⚠️ ' : isOwn ? '🟢' : '🔵';
    console.log(`${marker} ${i + 1}. ${product.title}`);
    console.log(`   EAN: ${ean || 'GEEN EAN'} ${isOwn ? '(eigen product)' : ''}`);
  });

  if (products.length > 10) {
    console.log(`\n... en ${products.length - 10} meer producten`);
  }

  console.log(`\n📊 Samenvatting (eerste pagina):`);
  console.log(`   Totaal producten: ${products.length}`);
  console.log(`   Eigen producten: ${ownProducts}`);
  console.log(`   Concurrent producten: ${competitorProducts}`);
  console.log(`   Zonder EAN: ${noEan}`);

  console.log(`\n💡 Conclusie:`);
  if (competitorProducts > 0) {
    console.log(`   ✅ API retourneert WEL concurrenten!`);
  } else if (ownProducts > 0) {
    console.log(`   ⚠️  API retourneert alleen EIGEN producten`);
    console.log(`   → We moeten een andere API gebruiken voor competitor discovery`);
  } else {
    console.log(`   ❓ Onduidelijk - geen eigen producten herkend in sample`);
  }

  return data;
}

async function main() {
  // Haal FashionPower customer op
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8')
    .single();

  if (!customer) {
    console.error('❌ Customer niet gevonden');
    return;
  }

  console.log(`\n🏪 Customer: ${customer.seller_name}`);

  // Get token
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  console.log('✅ Access token verkregen');

  // Haal een paar eigen EANs op
  const { data: ownEans } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', customer.id)
    .limit(50);

  const yourEans = (ownEans || []).map(p => p.ean);
  console.log(`✅ ${yourEans.length} eigen EANs geladen voor vergelijking`);

  // Test met sport-lower-body-wear categorie
  await testProductsList(token, '30016714', yourEans);

  console.log('\n✨ Test compleet!\n');
}

main().catch(console.error);
