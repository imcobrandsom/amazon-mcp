/**
 * Run competitor analysis in a loop until all categories are processed
 * Each iteration processes 1 category to avoid Vercel timeout
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
const API_URL = 'https://amazon-mcp-git-main-imcobrandsoms-projects.vercel.app/api/bol-sync-competitor-analysis';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getUniqueCategories() {
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null);

  return new Set((categories || []).map(c => c.category_id)).size;
}

async function getCatalogCount() {
  const { count } = await supabase
    .from('bol_competitor_catalog')
    .select('*', { count: 'exact', head: true })
    .eq('bol_customer_id', CUSTOMER_ID);

  return count || 0;
}

async function runOnce() {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-call': 'true',
    },
    body: JSON.stringify({
      customerId: CUSTOMER_ID,
      maxCategories: 1, // Process 1 category per call
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API failed (${res.status}): ${text}`);
  }

  return await res.json();
}

async function main() {
  console.log('🔄 COMPETITOR ANALYSIS LOOP\n');
  console.log('='.repeat(80));

  const totalCategories = await getUniqueCategories();
  console.log(`\n📊 Total categories to process: ${totalCategories}\n`);

  let iteration = 0;
  const maxIterations = totalCategories;

  while (iteration < maxIterations) {
    iteration++;

    console.log(`\n▶️  Iteration ${iteration}/${maxIterations}`);
    console.log('─'.repeat(80));

    try {
      const result = await runOnce();

      console.log(`✅ Response:`);
      console.log(`   Message: ${result.message}`);

      if (result.results && result.results.length > 0) {
        const customerResult = result.results[0];
        console.log(`   Status: ${customerResult.status}`);

        if (customerResult.detail) {
          const d = customerResult.detail;
          console.log(`   Categories analyzed: ${d.categories_analyzed || 0}`);
          console.log(`   Competitors found: ${d.competitors_found || 0}`);

          if (d.categoryResults) {
            console.log(`   Result: ${d.categoryResults}`);
          }
        }
      }

      // Check progress
      const catalogCount = await getCatalogCount();
      console.log(`\n📈 Progress: ${catalogCount} competitors in catalog`);

      // Stop if we see "... and X more categories" (meaning we hit the limit)
      const resultStr = JSON.stringify(result);
      if (!resultStr.includes('more categories')) {
        console.log('\n✅ All categories processed!');
        break;
      }

      // Wait 2 seconds between iterations to avoid rate limits
      console.log('\n⏳ Waiting 2 seconds...');
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.log(`\n❌ Error in iteration ${iteration}: ${err.message}`);
      console.log('   Stopping loop.\n');
      break;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('🏁 LOOP COMPLETE\n');

  const finalCatalogCount = await getCatalogCount();
  console.log(`📊 Final stats:`);
  console.log(`   Total categories: ${totalCategories}`);
  console.log(`   Competitors in catalog: ${finalCatalogCount}`);
  console.log('');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
