/**
 * Test: Product Placement API - geeft dit de catalog category ID?
 * GET /retailer/products/{ean}/placement
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

async function getProductPlacement(token, ean) {
  const res = await fetch(`https://api.bol.com/retailer/products/${ean}/placement`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl',
    },
  });

  console.log(`  Response status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}`, data: null };
  }

  const data = await res.json();
  return { error: null, data };
}

async function testProductsList(token, categoryId) {
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

  if (!res.ok) return { works: false, count: 0 };
  const data = await res.json();
  return { works: true, count: data.products?.length || 0 };
}

async function main() {
  console.log('🏪 Ophalen customer...');
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  console.log('🔐 Access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Haal een paar eigen EANs op
  console.log('\n📦 Ophalen test producten...');
  const { data: products } = await supabase
    .from('bol_product_categories')
    .select('ean, category_id, category_slug')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(3);

  if (!products || products.length === 0) {
    console.log('❌ Geen producten gevonden');
    return;
  }

  console.log(`✅ ${products.length} test producten geladen\n`);
  console.log('='.repeat(80));

  for (const product of products) {
    console.log(`\n📦 EAN: ${product.ean}`);
    console.log(`   Huidige ranking category: ${product.category_id} (${product.category_slug})`);

    console.log(`\n🔍 Calling /products/{ean}/placement...`);
    const { error, data } = await getProductPlacement(token, product.ean);

    if (error) {
      console.log(`  ❌ Error: ${error}`);
      continue;
    }

    console.log(`  ✅ Response ontvangen!\n`);
    console.log('  Volledige response:');
    console.log(JSON.stringify(data, null, 2));

    // Extract the deepest category ID from the nested structure
    function getDeepestCategoryId(categories) {
      if (!categories || categories.length === 0) return null;

      let deepest = null;
      function traverse(cats) {
        for (const cat of cats) {
          const id = cat.categoryId || cat.id;
          if (id) deepest = id;
          if (cat.subcategories?.length > 0) {
            traverse(cat.subcategories);
          }
        }
      }
      traverse(categories);
      return deepest;
    }

    const placementCategoryId = getDeepestCategoryId(data.categories);

    if (placementCategoryId) {
      console.log(`\n  📍 Placement category ID (deepest): ${placementCategoryId}`);

      // Test of deze ID werkt met /products/list
      console.log(`  🧪 Test /products/list met deze ID...`);
      const { works, count } = await testProductsList(token, placementCategoryId);

      if (works) {
        console.log(`  ✅ WERKT! ${count} producten gevonden`);
        console.log(`  → Dit is een CATALOG category ID!`);
      } else {
        console.log(`  ❌ Werkt niet met /products/list`);
      }
    } else {
      console.log(`\n  ⚠️  Geen categoryId gevonden in response`);
    }

    console.log('\n' + '-'.repeat(80));
    await new Promise(r => setTimeout(r, 500)); // Rate limiting
  }

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSIE:');
  console.log('Als /products/{ean}/placement catalog category IDs geeft,');
  console.log('dan kunnen we deze gebruiken voor /products/list!');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
