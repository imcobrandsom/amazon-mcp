/**
 * Debug: Check current database state and test a full category processing flow
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
  console.log('🔍 DEBUG: Current Database State\n');
  console.log('='.repeat(80));

  // 1. Check bol_product_categories
  console.log('\n1️⃣ bol_product_categories table:\n');

  const { data: allCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name, category_slug, ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  const uniqueCategories = new Map();
  for (const cat of allCategories || []) {
    if (!uniqueCategories.has(cat.category_id)) {
      uniqueCategories.set(cat.category_id, {
        id: cat.category_id,
        name: cat.category_name,
        slug: cat.category_slug,
        productCount: 0,
      });
    }
    uniqueCategories.get(cat.category_id).productCount++;
  }

  console.log(`   Total rows: ${allCategories?.length || 0}`);
  console.log(`   Unique categories: ${uniqueCategories.size}\n`);
  console.log('   Categories:');

  for (const [id, info] of uniqueCategories.entries()) {
    console.log(`   - ${id} (${info.slug || 'no-slug'}): ${info.productCount} products`);
  }

  // 2. Check bol_competitor_catalog
  console.log('\n2️⃣ bol_competitor_catalog table:\n');

  const { data: catalogData, count: catalogCount } = await supabase
    .from('bol_competitor_catalog')
    .select('*', { count: 'exact' })
    .eq('bol_customer_id', CUSTOMER_ID)
    .limit(5);

  console.log(`   Total rows: ${catalogCount || 0}`);
  if (catalogCount && catalogCount > 0) {
    console.log('\n   Sample entries:');
    for (const entry of catalogData || []) {
      console.log(`   - ${entry.competitor_ean}: ${entry.title?.substring(0, 60)}...`);
      console.log(`     Category: ${entry.category_slug} (${entry.category_id})`);
    }
  } else {
    console.log('   ❌ EMPTY - This is the problem!\n');
  }

  // 3. Test actual API flow for one category
  console.log('\n3️⃣ Testing API flow for first category:\n');

  const firstCategory = Array.from(uniqueCategories.values())[0];
  if (!firstCategory) {
    console.log('   ❌ No categories found!');
    return;
  }

  console.log(`   Category: ${firstCategory.slug}`);
  console.log(`   ID: ${firstCategory.id}`);
  console.log(`   Products in DB: ${firstCategory.productCount}\n`);

  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Get your EANs in this category
  const { data: yourProducts } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('category_id', firstCategory.id);

  const yourEans = new Set((yourProducts || []).map(p => p.ean));
  console.log(`   Your EANs in category: ${yourEans.size}`);

  // Call /products/list
  console.log(`\n   📡 Calling /products/list for category ${firstCategory.id}...`);

  const res = await fetch('https://api.bol.com/retailer/products/list', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Content-Type': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl',
    },
    body: JSON.stringify({
      countryCode: 'NL',
      categoryId: firstCategory.id,
      sort: 'POPULARITY',
      page: 1,
    }),
  });

  console.log(`   Response status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.log(`   ❌ API FAILED: ${text}\n`);
    console.log('\n💡 PROBLEM FOUND:');
    console.log('   The category ID from placement API does NOT work with /products/list!');
    console.log('   This means the placement data is incorrect or incompatible.\n');
    return;
  }

  const data = await res.json();
  const products = data.products || [];

  console.log(`   ✅ API Success: ${products.length} products returned\n`);

  // Filter competitors
  let ownFiltered = 0;
  let competitors = 0;

  for (const product of products) {
    const ean = product.eans?.[0]?.ean;
    if (!ean) continue;

    if (yourEans.has(ean)) {
      ownFiltered++;
    } else {
      competitors++;
    }
  }

  console.log(`   📊 Filter results:`);
  console.log(`      Total: ${products.length}`);
  console.log(`      Own products: ${ownFiltered}`);
  console.log(`      Competitors: ${competitors}\n`);

  if (competitors > 0) {
    console.log('   ✅ GOOD: Competitors found!');
    console.log('   The API and filtering logic both work correctly.\n');
  } else {
    console.log('   ⚠️  WARNING: No competitors found');
    console.log('   Either all products are yours, or something is wrong.\n');
  }

  console.log('='.repeat(80));
  console.log('\n💡 DIAGNOSIS:\n');

  if (catalogCount === 0 && competitors > 0) {
    console.log('❌ PROBLEM: API returns competitors but database is empty!');
    console.log('   → The competitor analysis sync is NOT inserting data');
    console.log('   → Check Vercel function logs for database insert errors\n');
  } else if (catalogCount === 0 && competitors === 0) {
    console.log('⚠️  NO competitors found in API response');
    console.log('   → Category might only contain your products');
    console.log('   → Try another category\n');
  } else {
    console.log('✅ Database has data! Sync is working.\n');
  }

  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
