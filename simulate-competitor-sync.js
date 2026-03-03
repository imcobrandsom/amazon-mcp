/**
 * Simulate competitor sync locally to see exact behavior
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔬 SIMULATING COMPETITOR SYNC\n');
  console.log('='.repeat(80));

  // Get customer
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Get categories
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name, category_slug, category_path')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  const uniqueCategories = new Map();
  for (const cat of categories || []) {
    if (!uniqueCategories.has(cat.category_id)) {
      uniqueCategories.set(cat.category_id, {
        categoryId: cat.category_id,
        categoryName: cat.category_name,
        categorySlug: cat.category_slug,
        categoryPath: cat.category_path,
      });
    }
  }

  console.log(`\n📊 Found ${uniqueCategories.size} unique categories\n`);

  // Process first category only
  const [catId, catInfo] = Array.from(uniqueCategories.entries())[0];

  console.log(`Processing: ${catInfo.categorySlug} (${catInfo.categoryId})\n`);

  // Get customer's EANs in this category
  const { data: yourProducts } = await supabase
    .from('bol_product_categories')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('category_id', catInfo.categoryId);

  const yourEans = new Set((yourProducts || []).map(p => p.ean));

  console.log(`Your EANs in category: ${yourEans.size}\n`);

  // Fetch competitors from /products/list
  console.log('🔍 Calling /products/list...');

  const competitorEans = new Map();
  let totalProducts = 0;
  let ownProductsFiltered = 0;

  for (let page = 1; page <= 10; page++) {
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
        categoryId: catInfo.categoryId,
        sort: 'POPULARITY',
        page,
      }),
    });

    if (!res.ok) {
      console.log(`❌ Page ${page} failed: ${res.status}`);
      const text = await res.text();
      console.log(text);
      break;
    }

    const data = await res.json();
    const products = data.products || [];

    if (products.length === 0) {
      console.log(`Page ${page}: no more products`);
      break;
    }

    totalProducts += products.length;

    for (const product of products) {
      const ean = product.eans?.[0]?.ean;
      if (!ean) {
        console.log(`  Product without EAN: ${product.title}`);
        continue;
      }
      if (yourEans.has(ean)) {
        ownProductsFiltered++;
        continue;
      }
      competitorEans.set(ean, product.title);
    }

    console.log(`Page ${page}: ${products.length} products, ${competitorEans.size} competitors so far`);
    await sleep(150);
  }

  console.log(`\n📊 Results:`);
  console.log(`   Total products: ${totalProducts}`);
  console.log(`   Own products: ${ownProductsFiltered}`);
  console.log(`   Competitors: ${competitorEans.size}\n`);

  if (competitorEans.size === 0) {
    console.log('❌ NO COMPETITORS FOUND!');
    console.log('   This is why the API returns "0 comp"\n');
    return;
  }

  // Try database insert
  console.log('💾 Attempting database insert...\n');

  const catalogInserts = Array.from(competitorEans.entries()).map(([ean, title]) => ({
    bol_customer_id: CUSTOMER_ID,
    competitor_ean: ean,
    category_slug: catInfo.categorySlug,
    category_id: catInfo.categoryId,
    title,
    is_customer_product: false,
    fetched_at: new Date().toISOString(),
  }));

  console.log(`Inserting ${catalogInserts.length} records...\n`);
  console.log('Sample record:');
  console.log(JSON.stringify(catalogInserts[0], null, 2));
  console.log('');

  const { data, error } = await supabase
    .from('bol_competitor_catalog')
    .upsert(catalogInserts, { onConflict: 'bol_customer_id,competitor_ean,category_slug' });

  if (error) {
    console.log(`❌ DATABASE ERROR: ${error.message}`);
    console.log('Error details:', error);
    console.log('');
  } else {
    console.log('✅ Database insert successful!');
    console.log('');

    // Verify
    const { count } = await supabase
      .from('bol_competitor_catalog')
      .select('*', { count: 'exact', head: true })
      .eq('bol_customer_id', CUSTOMER_ID);

    console.log(`📊 Total records in bol_competitor_catalog: ${count || 0}\n`);
  }

  console.log('='.repeat(80) + '\n');
}

main().catch(err => {
  console.error('💥 ERROR:', err.message);
  console.error(err);
});
