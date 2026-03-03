/**
 * Simpele test voor /retailer/products/list endpoint
 *
 * Run met: node test-products-list-simple.js
 *
 * Haalt Bol.com credentials uit Supabase en test of /products/list
 * concurrenten retourneert of alleen eigen producten.
 */

import { createClient } from '@supabase/supabase-js';

// Supabase config (uit .env.local)
const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'; // FashionPower
const CATEGORY_ID = '46673'; // Damesmode (uit category tree)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getBolToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://login.bol.com/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed: ${res.status} - ${text}`);
  }
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

  // Toon eerste 10 producten
  products.slice(0, 10).forEach((product, i) => {
    const ean = product.eans?.[0]?.ean;
    const isOwn = ean && yourEans.includes(ean);

    if (!ean) noEan++;
    else if (isOwn) ownProducts++;
    else competitorProducts++;

    const marker = !ean ? '⚠️ ' : isOwn ? '🟢' : '🔵';
    console.log(`${marker} ${i + 1}. ${product.title}`);
    console.log(`   EAN: ${ean || 'GEEN EAN'} ${isOwn ? '← EIGEN PRODUCT' : ''}`);
  });

  if (products.length > 10) {
    console.log(`\n... en ${products.length - 10} meer producten`);
  }

  console.log(`\n📊 Samenvatting (eerste 10 producten):`);
  console.log(`   Totaal producten op pagina 1: ${products.length}`);
  console.log(`   🟢 Eigen producten: ${ownProducts}`);
  console.log(`   🔵 Concurrent producten: ${competitorProducts}`);
  console.log(`   ⚠️  Zonder EAN: ${noEan}`);

  console.log(`\n💡 Conclusie:`);
  if (competitorProducts > 0) {
    console.log(`   ✅ API retourneert WEL concurrenten!`);
    console.log(`   → De huidige implementatie zou moeten werken`);
  } else if (ownProducts > 0 && competitorProducts === 0) {
    console.log(`   ❌ API retourneert ALLEEN EIGEN producten`);
    console.log(`   → We moeten een andere API gebruiken voor competitor discovery`);
  } else {
    console.log(`   ❓ Onduidelijk - geen eigen producten herkend in sample`);
  }

  return data;
}

async function main() {
  console.log('\n🏪 Ophalen FashionPower customer gegevens uit Supabase...');

  const { data: customer, error } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  if (error || !customer) {
    console.error('❌ Customer niet gevonden:', error?.message);
    process.exit(1);
  }

  console.log(`✅ Customer: ${customer.seller_name}`);

  console.log('\n🔐 Ophalen access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  console.log('✅ Access token verkregen');

  console.log('\n📦 Ophalen eigen EANs voor vergelijking...');
  const { data: ownEans } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .limit(200);

  const yourEans = (ownEans || []).map(p => p.ean);
  console.log(`✅ ${yourEans.length} eigen EANs geladen`);

  await testProductsList(token, CATEGORY_ID, yourEans);

  console.log('\n✨ Test compleet!\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
