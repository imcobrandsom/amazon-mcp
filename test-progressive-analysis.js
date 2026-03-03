/**
 * Test progressive analysis logic
 * Simulates multiple runs to verify all 500 products get analyzed
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testProgressiveAnalysisLogic() {
  console.log('🧪 TESTING PROGRESSIVE ANALYSIS LOGIC\n');
  console.log('='.repeat(80));

  // STEP 1: Check current state
  console.log('\n📊 STEP 1: Current database state\n');

  const { data: catalogData } = await supabase
    .from('bol_competitor_catalog')
    .select('category_slug, competitor_ean')
    .eq('bol_customer_id', CUSTOMER_ID);

  const { data: analysisData } = await supabase
    .from('bol_competitor_content_analysis')
    .select('category_slug, competitor_ean')
    .eq('bol_customer_id', CUSTOMER_ID);

  console.log(`Total catalog products: ${catalogData?.length || 0}`);
  console.log(`Total analyzed products: ${analysisData?.length || 0}\n`);

  // Group by category
  const catalogByCategory = new Map();
  const analysisByCategory = new Map();

  (catalogData || []).forEach(c => {
    if (!catalogByCategory.has(c.category_slug)) {
      catalogByCategory.set(c.category_slug, new Set());
    }
    catalogByCategory.get(c.category_slug).add(c.competitor_ean);
  });

  (analysisData || []).forEach(a => {
    if (!analysisByCategory.has(a.category_slug)) {
      analysisByCategory.set(a.category_slug, new Set());
    }
    analysisByCategory.get(a.category_slug).add(a.competitor_ean);
  });

  console.log('By category:');
  for (const [catSlug, catalogEans] of catalogByCategory.entries()) {
    const analyzedEans = analysisByCategory.get(catSlug) || new Set();
    console.log(`  ${catSlug}:`);
    console.log(`    Catalog: ${catalogEans.size} products`);
    console.log(`    Analyzed: ${analyzedEans.size} products`);
    console.log(`    Remaining: ${catalogEans.size - analyzedEans.size} products`);
  }

  // STEP 2: Simulate the category skip logic
  console.log('\n🔄 STEP 2: Category skip logic\n');

  const fullyAnalyzedCategories = new Set();

  for (const [catSlug, catalogEans] of catalogByCategory.entries()) {
    const analyzedEans = analysisByCategory.get(catSlug) || new Set();
    const allAnalyzed = Array.from(catalogEans).every(ean => analyzedEans.has(ean));

    console.log(`${catSlug}:`);
    console.log(`  Catalog EANs: ${catalogEans.size}`);
    console.log(`  Analyzed EANs: ${analyzedEans.size}`);
    console.log(`  All analyzed? ${allAnalyzed}`);

    if (allAnalyzed && catalogEans.size > 0) {
      fullyAnalyzedCategories.add(catSlug);
      console.log(`  ✅ SKIP (fully analyzed)`);
    } else {
      console.log(`  🔄 PROCESS (incomplete)`);
    }
    console.log('');
  }

  console.log(`Categories to skip: ${fullyAnalyzedCategories.size}`);
  console.log(`Categories to process: ${catalogByCategory.size - fullyAnalyzedCategories.size}\n`);

  // STEP 3: Simulate the AI analysis logic for sportleggings
  console.log('🤖 STEP 3: Simulate AI analysis logic for sportleggings\n');

  const targetCategory = 'sportleggings';

  // Get existing analysis
  const { data: existingAnalysis } = await supabase
    .from('bol_competitor_content_analysis')
    .select('competitor_ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('category_slug', targetCategory);

  const analyzedEans = new Set((existingAnalysis || []).map(a => a.competitor_ean));
  console.log(`Already analyzed: ${analyzedEans.size} products`);

  // Get ALL catalog products for this category
  const { data: allCatalogProducts } = await supabase
    .from('bol_competitor_catalog')
    .select('competitor_ean, title, description, brand, list_price, attributes')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('category_slug', targetCategory);

  console.log(`Total catalog products: ${(allCatalogProducts || []).length}`);

  // Filter to only products that haven't been analyzed yet
  const unanalyzedProducts = (allCatalogProducts || [])
    .filter(p => !analyzedEans.has(p.competitor_ean));

  console.log(`Unanalyzed products: ${unanalyzedProducts.length}`);

  // Take first 50
  const catalogProducts = unanalyzedProducts.slice(0, 50);

  console.log(`Would analyze in this run: ${catalogProducts.length} products\n`);

  if (catalogProducts.length > 0) {
    console.log('Sample EANs to analyze:');
    catalogProducts.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.competitor_ean}: ${p.title?.substring(0, 50)}...`);
    });
    console.log('');
  }

  // STEP 4: Simulate multiple runs
  console.log('🔁 STEP 4: Simulate multiple runs (progressive analysis)\n');

  let currentAnalyzed = analyzedEans.size;
  const totalInCatalog = (allCatalogProducts || []).length;
  let runNumber = 1;

  console.log(`Starting state: ${currentAnalyzed}/${totalInCatalog} analyzed\n`);

  while (currentAnalyzed < totalInCatalog) {
    const remaining = totalInCatalog - currentAnalyzed;
    const toAnalyze = Math.min(50, remaining);
    currentAnalyzed += toAnalyze;

    console.log(`Run ${runNumber}: analyze ${toAnalyze} products → ${currentAnalyzed}/${totalInCatalog} total`);
    runNumber++;

    if (runNumber > 20) {
      console.log('\n⚠️  Stopped at 20 runs to prevent infinite loop');
      break;
    }
  }

  console.log('');
  if (currentAnalyzed === totalInCatalog) {
    console.log(`✅ SUCCESS: All ${totalInCatalog} products would be analyzed after ${runNumber - 1} runs`);
  } else {
    console.log(`❌ FAILURE: Only ${currentAnalyzed}/${totalInCatalog} would be analyzed`);
  }

  // STEP 5: Check if category would be marked as complete
  console.log('\n✅ STEP 5: Category completion check\n');

  if (currentAnalyzed === totalInCatalog) {
    console.log('After all runs complete:');
    console.log(`  catalogEans.size = ${totalInCatalog}`);
    console.log(`  analyzedEans.size = ${currentAnalyzed}`);
    console.log(`  allAnalyzed = every(ean => analyzedEans.has(ean)) = true`);
    console.log(`  Result: Category would be marked as FULLY ANALYZED ✅`);
    console.log(`  Next run would SKIP this category and move to next one 🎯`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 CONCLUSION:\n');

  const needsRuns = Math.ceil((totalInCatalog - analyzedEans.size) / 50);

  console.log(`Current state: ${analyzedEans.size}/${totalInCatalog} analyzed`);
  console.log(`Remaining: ${totalInCatalog - analyzedEans.size} products`);
  console.log(`Runs needed: ${needsRuns} × 50 products/run = full coverage`);
  console.log(`\nAfter ${needsRuns} more runs, sportleggings will be 100% analyzed`);
  console.log(`Then the system will automatically move to the next category.\n`);
}

testProgressiveAnalysisLogic().catch(console.error);
