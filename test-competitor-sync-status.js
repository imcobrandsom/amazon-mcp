/**
 * Debug: Check competitor sync status and test if API works
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
  console.log('🔍 COMPETITOR SYNC DEBUG\n');
  console.log('='.repeat(80));

  // 1. Check category IDs in database
  console.log('\n1️⃣ Checking category IDs in bol_product_categories...\n');
  const { data: categories } = await supabase
    .from('bol_product_categories')
    .select('category_id, category_name, category_path, ean')
    .eq('bol_customer_id', CUSTOMER_ID)
    .not('category_id', 'is', null)
    .limit(5);

  if (!categories || categories.length === 0) {
    console.log('❌ No categories found! Extended sync needs to run first.\n');
    return;
  }

  console.log(`✅ Found ${categories.length} categories (showing first 5):\n`);
  for (const cat of categories) {
    console.log(`   Category ID: ${cat.category_id}`);
    console.log(`   Name: ${cat.category_name || 'NULL'}`);
    console.log(`   Path: ${cat.category_path || 'NULL'}`);
    console.log(`   Sample EAN: ${cat.ean}`);
    console.log('');
  }

  // 2. Check competitor catalog table
  console.log('2️⃣ Checking bol_competitor_catalog table...\n');
  const { data: competitors, count } = await supabase
    .from('bol_competitor_catalog')
    .select('*', { count: 'exact' })
    .eq('bol_customer_id', CUSTOMER_ID)
    .limit(1);

  console.log(`   Total rows: ${count || 0}`);
  if (count === 0) {
    console.log('   ❌ EMPTY - competitor analysis needs to run!\n');
  } else {
    console.log('   ✅ Has data\n');
  }

  // 3. Check category insights
  console.log('3️⃣ Checking bol_category_insights table...\n');
  const { data: insights } = await supabase
    .from('bol_category_insights')
    .select('category_id, category_name, competitor_count, created_at')
    .eq('bol_customer_id', CUSTOMER_ID)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!insights || insights.length === 0) {
    console.log('   ❌ EMPTY - no insights generated\n');
  } else {
    console.log(`   ✅ Found ${insights.length} insights:\n`);
    for (const insight of insights) {
      console.log(`   - ${insight.category_name || insight.category_id}: ${insight.competitor_count} competitors`);
    }
    console.log('');
  }

  // 4. Check recent sync jobs
  console.log('4️⃣ Checking recent competitor-analysis sync jobs...\n');
  const { data: jobs } = await supabase
    .from('bol_sync_jobs')
    .select('sync_type, status, created_at, completed_at, error')
    .eq('bol_customer_id', CUSTOMER_ID)
    .eq('sync_type', 'competitor-analysis')
    .order('created_at', { ascending: false })
    .limit(3);

  if (!jobs || jobs.length === 0) {
    console.log('   ❌ No competitor-analysis jobs found!\n');
    console.log('   💡 The competitor analysis sync has never run.');
    console.log('   💡 This is a SEPARATE sync from extended sync.\n');
  } else {
    console.log(`   ✅ Found ${jobs.length} jobs:\n`);
    for (const job of jobs) {
      console.log(`   - Status: ${job.status}`);
      console.log(`     Created: ${job.created_at}`);
      console.log(`     Completed: ${job.completed_at || 'N/A'}`);
      if (job.error) console.log(`     Error: ${job.error}`);
      console.log('');
    }
  }

  // 5. Test if /products/list works with one of the category IDs
  console.log('5️⃣ Testing /products/list API with first category ID...\n');

  const { data: customer } = await supabase
    .from('bol_customers')
    .select('*')
    .eq('id', CUSTOMER_ID)
    .single();

  const token = await getBolToken(customer.bol_client_id, customer.bol_client_secret);
  const testCategoryId = categories[0].category_id;

  console.log(`   Testing category ID: ${testCategoryId}`);
  console.log(`   Category name: ${categories[0].category_name || 'NULL'}\n`);

  try {
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

    console.log(`   Response status: ${res.status}`);

    if (!res.ok) {
      const text = await res.text();
      console.log(`   ❌ API FAILED: ${text}\n`);
      console.log('   💡 This category ID does NOT work with /products/list');
      console.log('   💡 The placement API may not have been used correctly\n');
    } else {
      const data = await res.json();
      console.log(`   ✅ API SUCCESS: ${data.products?.length || 0} products found\n`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}\n`);
  }

  console.log('='.repeat(80));
  console.log('\n📋 SUMMARY:\n');

  const hasCategories = categories && categories.length > 0;
  const hasCompetitors = count && count > 0;
  const hasInsights = insights && insights.length > 0;
  const hasJobs = jobs && jobs.length > 0;

  console.log(`   Categories detected: ${hasCategories ? '✅' : '❌'}`);
  console.log(`   Competitor catalog populated: ${hasCompetitors ? '✅' : '❌'}`);
  console.log(`   Category insights generated: ${hasInsights ? '✅' : '❌'}`);
  console.log(`   Competitor-analysis job ran: ${hasJobs ? '✅' : '❌'}`);

  console.log('\n💡 NEXT STEPS:\n');
  if (!hasJobs) {
    console.log('   ⚠️  Competitor analysis sync has NEVER run!');
    console.log('   → This is a SEPARATE endpoint from extended sync');
    console.log('   → You need to trigger it manually or wait for the cron job\n');
    console.log('   Manual trigger:');
    console.log('   POST /api/bol-sync-competitor-analysis');
    console.log('   Or check if cron job is configured\n');
  } else if (!hasCompetitors) {
    console.log('   ⚠️  Competitor analysis ran but found no data');
    console.log('   → Check the error field in sync jobs');
    console.log('   → Check Vercel function logs for details\n');
  } else {
    console.log('   ✅ Everything looks good! Data should be visible in UI.\n');
  }

  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
