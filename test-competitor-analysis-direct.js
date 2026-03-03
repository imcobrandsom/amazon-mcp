/**
 * Direct test of competitor analysis logic
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

  if (!res.ok) {
    console.log(`   ❌ Placement API failed for ${ean}: ${res.status}`);
    return null;
  }
  return await res.json();
}

function extractDeepestCategoryId(placement) {
  if (!placement?.categories || placement.categories.length === 0) return null;

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

  traverse(placement.categories);
  return deepest;
}

function extractCategoryPath(placement) {
  if (!placement?.categories || placement.categories.length === 0) return null;

  const names = [];

  function traverse(cats) {
    for (const cat of cats) {
      const name = cat.categoryName || cat.name;
      if (name) names.push(name);
      if (cat.subcategories?.length > 0) {
        traverse(cat.subcategories);
      }
    }
  }

  traverse(placement.categories);
  return names.length > 0 ? names.join(' > ') : null;
}

async function main() {
  console.log('🔬 DIRECT TEST: Competitor Analysis Logic\n');
  console.log('='.repeat(80));

  // 1. Get customer
  console.log('\n1️⃣ Getting customer...');
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  console.log(`✅ ${customer.seller_name}\n`);

  // 2. Get token
  console.log('2️⃣ Getting access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  console.log('✅ Token received\n');

  // 3. Get EANs from competitor snapshots
  console.log('3️⃣ Getting EANs from bol_competitor_snapshots...');
  const { data: competitorSnapshots } = await supabase
    .from('bol_competitor_snapshots')
    .select('ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .order('fetched_at', { ascending: false })
    .limit(200);

  if (!competitorSnapshots || competitorSnapshots.length === 0) {
    console.log('❌ No competitor snapshots found!\n');
    return;
  }

  const eans = [...new Set(competitorSnapshots.map(s => s.ean))].filter(Boolean).slice(0, 50);
  console.log(`✅ Found ${eans.length} unique EANs\n`);

  // 4. Test placement API for first 3 EANs
  console.log('4️⃣ Testing placement API for first 3 EANs...\n');

  let successCount = 0;
  let failCount = 0;

  for (const ean of eans.slice(0, 3)) {
    console.log(`Testing EAN: ${ean}`);

    try {
      const placement = await getProductPlacement(token, ean);

      if (!placement) {
        console.log(`   ❌ No placement data\n`);
        failCount++;
        continue;
      }

      const categoryId = extractDeepestCategoryId(placement);
      const categoryPath = extractCategoryPath(placement);
      const categoryName = categoryPath?.split(' > ').pop() ?? null;

      if (!categoryId) {
        console.log(`   ⚠️  No category ID found in placement\n`);
        failCount++;
        continue;
      }

      console.log(`   ✅ Category ID: ${categoryId}`);
      console.log(`   ✅ Category Name: ${categoryName}`);
      console.log(`   ✅ Path: ${categoryPath?.substring(0, 80)}...\n`);

      successCount++;

      await new Promise(r => setTimeout(r, 200)); // Rate limiting
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}\n`);
      failCount++;
    }
  }

  console.log('='.repeat(80));
  console.log(`\n📊 Results: ${successCount} success, ${failCount} failed\n`);

  if (successCount === 0) {
    console.log('❌ PROBLEM: Placement API is not working!');
    console.log('   This explains why competitor analysis fails.\n');
  } else {
    console.log('✅ Placement API works!');
    console.log('   The problem must be elsewhere in the sync flow.\n');
  }

  console.log('='.repeat(80) + '\n');
}

main().catch(err => {
  console.error('\n💥 FATAL ERROR:', err);
  console.error('\nStack:', err.stack);
});
