/**
 * Test: Is er een relatie tussen GPC chunkId en category tree?
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

async function getCategoryTree(token) {
  const res = await fetch('https://api.bol.com/retailer/products/categories', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl-NL',
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.categories || [];
}

function flattenTree(nodes, depth = 0) {
  const result = [];
  for (const node of nodes) {
    result.push({
      id: node.categoryId,
      name: node.categoryName,
      depth,
    });
    if (node.subcategories?.length) {
      result.push(...flattenTree(node.subcategories, depth + 1));
    }
  }
  return result;
}

async function getCatalogProduct(token, ean) {
  const res = await fetch(`https://api.bol.com/retailer/content/catalog-products/${ean}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.retailer.v10+json',
      'Accept-Language': 'nl-NL',
    },
  });

  if (!res.ok) return null;
  return await res.json();
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

  // Haal category tree op
  console.log('\n🌳 Ophalen category tree...');
  const tree = await getCategoryTree(token);
  if (!tree) {
    console.log('❌ Category tree kon niet worden opgehaald');
    return;
  }

  const flat = flattenTree(tree);
  console.log(`✅ ${flat.length} categorieën in tree`);

  // Haal een paar producten op met GPC data
  console.log('\n📦 Ophalen test product...');
  const testEan = '8720168075215'; // Van jouw screenshot

  const catalogData = await getCatalogProduct(token, testEan);

  if (!catalogData) {
    console.log('❌ Product niet gevonden in catalog');
    return;
  }

  const gpcChunkId = catalogData.gpc?.chunkId;
  console.log(`\n✅ Product opgehaald`);
  console.log(`   GPC chunk ID: ${gpcChunkId}`);

  // Check of GPC chunk ID voorkomt in category tree
  console.log(`\n🔍 Zoeken naar "${gpcChunkId}" in category tree...`);

  const match = flat.find(c => c.id === gpcChunkId);

  if (match) {
    console.log(`✅ MATCH GEVONDEN!`);
    console.log(`   Category: ${match.name}`);
    console.log(`   ID: ${match.id}`);
    console.log(`   Depth: ${match.depth}`);
  } else {
    console.log(`❌ GEEN MATCH - GPC chunk ID komt niet voor in category tree`);
  }

  // Check ook onze ranking category IDs
  console.log(`\n📊 Check onze ranking category IDs...`);
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_slug')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(3);

  for (const cat of categories || []) {
    const catMatch = flat.find(c => c.id === cat.category_id);
    console.log(`   ${cat.category_id} (${cat.category_slug}): ${catMatch ? '✅ IN TREE' : '❌ NIET IN TREE'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSIE:');
  if (match) {
    console.log('✅ GPC chunk ID komt WEL voor in category tree!');
    console.log('   → We kunnen GPC chunk ID gebruiken voor /products/list');
  } else {
    console.log('❌ GPC chunk ID is ook niet bruikbaar');
    console.log('   → We moeten competitor data uit snapshots halen');
  }
  console.log('='.repeat(60));
}

main().catch(console.error);
