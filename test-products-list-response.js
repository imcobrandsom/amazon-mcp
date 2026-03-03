/**
 * Test the exact structure of /products/list API response
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
  console.log('🔍 Testing /products/list API response structure\n');

  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Get a category ID from database
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(1);

  const testCategoryId = categories[0].category_id;
  console.log(`Testing category: ${testCategoryId} (${categories[0].category_name})\n`);

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
      categoryId: testCategoryId,
      sort: 'POPULARITY',
      page: 1,
    }),
  });

  if (!res.ok) {
    console.log(`❌ API failed: ${res.status}`);
    const text = await res.text();
    console.log(text);
    return;
  }

  const data = await res.json();

  console.log('✅ API Success!\n');
  console.log(`Total products: ${data.products?.length || 0}\n`);

  if (data.products && data.products.length > 0) {
    console.log('First product structure:\n');
    console.log(JSON.stringify(data.products[0], null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('\n🔍 EAN extraction test:\n');

    const product = data.products[0];

    // Try different ways to extract EAN
    console.log(`Method 1 (product.eans?.[0]?.ean): ${product.eans?.[0]?.ean || 'NULL'}`);
    console.log(`Method 2 (product.ean): ${product.ean || 'NULL'}`);
    console.log(`Method 3 (product.gtin): ${product.gtin || 'NULL'}`);

    if (product.eans) {
      console.log(`\nproduct.eans structure:`);
      console.log(JSON.stringify(product.eans, null, 2));
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 All products EAN check:\n');

    let withEan = 0;
    let withoutEan = 0;

    for (const p of data.products) {
      const ean = p.eans?.[0]?.ean || p.ean || p.gtin;
      if (ean) {
        withEan++;
      } else {
        withoutEan++;
        console.log(`   No EAN: ${p.title || 'No title'}`);
      }
    }

    console.log(`\n✅ Products with EAN: ${withEan}`);
    console.log(`❌ Products without EAN: ${withoutEan}\n`);
  }
}

main().catch(console.error);
