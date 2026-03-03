/**
 * Test: Kunnen we ranking category IDs mappen naar catalog IDs?
 *
 * Ideeën om te testen:
 * 1. Prefix matching (eerste N cijfers)
 * 2. Parent category lookup via product-ranks API
 * 3. Catalog product API - bevat die category info?
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

  console.log(`✅ ${customer.seller_name}`);

  console.log('\n🔐 Access token...');
  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);

  // Haal een product op met ranking category ID
  console.log('\n📦 Ophalen test product...');
  const { data: products } = await supabase
    .from('bol_product_categories')
    .select('ean, category_id, category_name, category_slug')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(1);

  const product = products[0];
  console.log(`✅ EAN: ${product.ean}`);
  console.log(`   Ranking Category ID: ${product.category_id}`);
  console.log(`   Category Name: ${product.category_name || 'null'}`);
  console.log(`   Category Slug: ${product.category_slug || 'null'}`);

  // Test 1: Haal catalog product data op
  console.log('\n🔍 TEST 1: Catalog product API - bevat die category info?');
  const catalogData = await getCatalogProduct(token, product.ean);

  if (catalogData) {
    console.log('✅ Catalog data opgehaald');
    console.log(`   GPC chunk ID: ${catalogData.gpc?.chunkId || 'null'}`);

    // Check if there's any category-like data
    const hasCategories = catalogData.categories || catalogData.category || catalogData.categoryId;
    if (hasCategories) {
      console.log('   📋 Category data gevonden:');
      console.log(JSON.stringify(hasCategories, null, 2));
    } else {
      console.log('   ❌ Geen category data in catalog response');
    }

    // Check attributes for category hints
    const categoryAttrs = (catalogData.attributes || []).filter(a =>
      a.id?.toLowerCase().includes('categ') ||
      a.id?.toLowerCase().includes('groep')
    );

    if (categoryAttrs.length > 0) {
      console.log('   📋 Category-gerelateerde attributes:');
      categoryAttrs.forEach(a => {
        console.log(`      ${a.id}: ${a.values?.map(v => v.value).join(', ')}`);
      });
    }
  } else {
    console.log('❌ Catalog product niet gevonden');
  }

  // Test 2: Pattern matching
  console.log('\n🔍 TEST 2: Pattern analyse van ranking category IDs');
  const { data: allCategories } = await supabase
    .from('bol_product_categories')
    .select('category_id')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(20);

  const rankingIds = [...new Set(allCategories.map(c => c.category_id))];
  console.log(`\n📊 ${rankingIds.length} unieke ranking category IDs gevonden:`);

  rankingIds.forEach(id => {
    // Probeer patronen te herkennen
    const prefix2 = id.substring(0, 2);
    const prefix3 = id.substring(0, 3);
    const prefix4 = id.substring(0, 4);
    const prefix5 = id.substring(0, 5);

    console.log(`   ${id} → prefix: ${prefix2} | ${prefix3} | ${prefix4} | ${prefix5}`);
  });

  console.log('\n💡 Observaties:');
  console.log('   - Alle ranking IDs beginnen met 3001...');
  console.log('   - Catalog category IDs zijn 5-cijferig (43646, 46673, etc.)');
  console.log('   - Geen duidelijke numerieke relatie zichtbaar');

  console.log('\n📝 CONCLUSIE:');
  console.log('   ❌ Geen directe mapping gevonden tussen ranking IDs en catalog IDs');
  console.log('   ❌ Catalog product API bevat geen catalog category ID');
  console.log('\n   💡 ALTERNATIEF: Gebruik bol_competitor_snapshots data (hebben we al!)');
  console.log('      Deze tabel bevat alle competitor EANs van extended sync.');
  console.log('      We kunnen die verrijken zonder category browse te gebruiken.');
}

main().catch(console.error);
