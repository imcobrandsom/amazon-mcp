/**
 * Test: Haal de category tree op en vergelijk met product-ranks IDs
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

  console.log(`Category tree response: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Error:\n${text}`);
    return null;
  }

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

async function main() {
  console.log('🏪 Ophalen customer...');
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  console.log(`✅ ${customer.seller_name}`);

  console.log('\n🔐 Access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  console.log('✅ Token verkregen');

  console.log('\n🌳 Ophalen category tree...');
  const tree = await getCategoryTree(token);

  if (!tree) {
    console.log('\n❌ Category tree kon niet worden opgehaald (waarschijnlijk rate limit)');
    return;
  }

  const flat = flattenTree(tree);
  console.log(`✅ ${flat.length} categorieën gevonden`);

  // Toon eerste 10 top-level categorieën
  console.log('\n📋 Top-level categorieën:');
  flat.filter(c => c.depth === 0).slice(0, 10).forEach(c => {
    console.log(`  ${c.id} - ${c.name}`);
  });

  // Haal onze product-ranks category IDs op
  console.log('\n🔍 Vergelijking met onze product category IDs...');
  const { data: ourCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(5);

  const ourIds = [...new Set((ourCategories || []).map(c => c.category_id))];
  console.log(`\nOnze category IDs (uit product-ranks):`);
  ourIds.forEach(id => console.log(`  ${id}`));

  console.log(`\n📊 Match check:`);
  const matches = ourIds.filter(id => flat.some(c => c.id === id));
  const noMatches = ourIds.filter(id => !flat.some(c => c.id === id));

  if (matches.length > 0) {
    console.log(`✅ ${matches.length} IDs komen VOOR in category tree:`);
    matches.forEach(id => {
      const cat = flat.find(c => c.id === id);
      console.log(`  ${id} → ${cat.name}`);
    });
  }

  if (noMatches.length > 0) {
    console.log(`❌ ${noMatches.length} IDs komen NIET voor in category tree:`);
    noMatches.forEach(id => console.log(`  ${id}`));
  }

  console.log('\n' + '='.repeat(60));
  if (noMatches.length > 0) {
    console.log('❌ CONCLUSIE: Product-ranks IDs ≠ Catalog category IDs');
    console.log('   → Dit verklaart waarom /products/list faalt');
    console.log('   → We moeten een andere benadering kiezen');
  } else {
    console.log('✅ CONCLUSIE: Alle IDs matchen!');
    console.log('   → Probleem ligt ergens anders');
  }
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
