/**
 * Dump ALLE categorieën uit category tree en check of onze ranking IDs erin staan
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Category tree failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.categories || [];
}

function flattenTree(nodes, path = '', depth = 0) {
  const result = [];
  for (const node of nodes) {
    const currentPath = path ? `${path} > ${node.categoryName}` : node.categoryName;
    result.push({
      id: node.categoryId,
      name: node.categoryName,
      path: currentPath,
      depth,
    });
    if (node.subcategories?.length) {
      result.push(...flattenTree(node.subcategories, currentPath, depth + 1));
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

  console.log('🔐 Access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  console.log('\n🌳 Ophalen VOLLEDIGE category tree...');
  const tree = await getCategoryTree(token);
  const flat = flattenTree(tree);

  console.log(`✅ ${flat.length} categorieën gevonden`);

  // Haal onze ranking category IDs op
  console.log('\n📦 Ophalen onze ranking category IDs...');
  const { data: ourCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_slug')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  const ourIds = [...new Set((ourCategories || []).map(c => c.category_id))];
  console.log(`✅ ${ourIds.length} unieke ranking category IDs in onze database`);

  // Schrijf volledige lijst naar bestand
  const output = flat.map(c => `${c.id}\t${c.name}\t${c.path}`).join('\n');
  writeFileSync('/tmp/bol-categories-full.txt', output);
  console.log('\n💾 Volledige lijst geschreven naar: /tmp/bol-categories-full.txt');

  // Cross-check
  console.log('\n🔍 CROSS-CHECK: Onze ranking IDs vs catalog categories\n');
  console.log('='.repeat(80));

  let foundCount = 0;
  let notFoundCount = 0;

  for (const id of ourIds) {
    const match = flat.find(c => c.id === id);
    if (match) {
      console.log(`✅ ${id} → GEVONDEN: ${match.name}`);
      foundCount++;
    } else {
      console.log(`❌ ${id} → NIET GEVONDEN`);
      notFoundCount++;
    }
  }

  console.log('='.repeat(80));
  console.log(`\n📊 Resultaat:`);
  console.log(`   ✅ Gevonden in catalog: ${foundCount}/${ourIds.length}`);
  console.log(`   ❌ NIET gevonden: ${notFoundCount}/${ourIds.length}`);

  if (notFoundCount > 0) {
    console.log(`\n💡 Zoeken naar patronen in NIET-gevonden IDs:`);
    const notFound = ourIds.filter(id => !flat.find(c => c.id === id));

    // Check of ze in de volledige lijst voorkomen als substring
    console.log('\n   Checking of ze als substring voorkomen...');
    for (const id of notFound.slice(0, 3)) {
      const partialMatches = flat.filter(c =>
        c.id.includes(id.substring(0, 5)) || id.includes(c.id)
      );
      if (partialMatches.length > 0) {
        console.log(`   ${id}:`);
        partialMatches.slice(0, 3).forEach(m => {
          console.log(`      → Mogelijk verwant: ${m.id} (${m.name})`);
        });
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  if (notFoundCount === ourIds.length) {
    console.log('❌ CONCLUSIE: GEEN ENKELE ranking ID komt voor in catalog');
    console.log('   → Ranking categories en catalog categories zijn COMPLEET verschillende systemen');
    console.log('   → /products/list is NIET bruikbaar met onze huidige data');
  } else if (foundCount === ourIds.length) {
    console.log('✅ CONCLUSIE: ALLE ranking IDs komen voor in catalog!');
    console.log('   → We kunnen /products/list gebruiken');
  } else {
    console.log(`⚠️  CONCLUSIE: Gemengd resultaat (${foundCount} van ${ourIds.length})`);
  }
  console.log('='.repeat(80) + '\n');

  console.log('📄 Bekijk /tmp/bol-categories-full.txt voor de volledige lijst');
}

main().catch(console.error);
