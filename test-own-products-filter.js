/**
 * Test if all products in /products/list are being filtered as "own products"
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
  console.log('🔍 Testing own products filter logic\n');
  console.log('='.repeat(80));

  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Get a category from database
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name, category_slug')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(1);

  const category = categories[0];
  console.log(`\nTest category: ${category.category_id}`);
  console.log(`Name: ${category.category_name}`);
  console.log(`Slug: ${category.category_slug}\n`);

  // Get customer's EANs in this category (from database)
  const { data: yourProducts } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('category_id', category.category_id);

  const yourEans = new Set((yourProducts || []).map(p => p.ean));

  console.log(`Your EANs in this category (from bol_product_categories): ${yourEans.size}`);
  if (yourEans.size > 0) {
    console.log('Your EANs:');
    Array.from(yourEans).slice(0, 5).forEach(ean => console.log(`   - ${ean}`));
    if (yourEans.size > 5) console.log(`   ... and ${yourEans.size - 5} more`);
  }
  console.log('');

  // Fetch products from /products/list
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
      categoryId: category.category_id,
      sort: 'POPULARITY',
      page: 1,
    }),
  });

  if (!res.ok) {
    console.log(`❌ API failed: ${res.status}`);
    return;
  }

  const data = await res.json();
  const products = data.products || [];

  console.log(`Products from /products/list: ${products.length}\n`);

  // Test filtering logic
  let ownProductsFiltered = 0;
  let competitorCount = 0;
  const competitorEans = [];

  for (const product of products) {
    const ean = product.eans?.[0]?.ean;
    if (!ean) {
      console.log(`   ⚠️  Product without EAN: ${product.title}`);
      continue;
    }

    if (yourEans.has(ean)) {
      ownProductsFiltered++;
    } else {
      competitorCount++;
      if (competitorEans.length < 5) {
        competitorEans.push({ ean, title: product.title });
      }
    }
  }

  console.log('='.repeat(80));
  console.log('\n📊 FILTER RESULTS:\n');
  console.log(`   Total products from API: ${products.length}`);
  console.log(`   Your products (filtered): ${ownProductsFiltered}`);
  console.log(`   Competitor products: ${competitorCount}\n`);

  if (competitorCount > 0) {
    console.log('✅ GOOD: Found competitors!\n');
    console.log('Sample competitors:');
    competitorEans.forEach(({ ean, title }) => {
      console.log(`   - ${ean}: ${title}`);
    });
  } else {
    console.log('❌ PROBLEM: NO competitors found!');
    console.log(`   ALL ${products.length} products are being filtered as "own products"\n`);
    console.log('🔍 This means either:');
    console.log('   1. All products in this category really ARE your products (unlikely)');
    console.log('   2. The yourEans Set is incorrectly populated');
    console.log('   3. The EAN matching logic has a bug\n');
  }

  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
