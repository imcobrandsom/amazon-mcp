/**
 * Test script voor Bol.com Search Terms API
 * Run: npx tsx api/test-search-terms.ts [keyword]
 */
import { getBolToken, getSearchTerms } from './_lib/bol-api-client.js';
import { createAdminClient } from './_lib/supabase-admin.js';

async function main() {
  const keyword = process.argv[2] || 'sportlegging';

  console.log('='.repeat(80));
  console.log('BOL.COM SEARCH TERMS API TEST');
  console.log('='.repeat(80));
  console.log(`Keyword: "${keyword}"`);
  console.log('');

  // Haal FashionPower credentials op
  const supabase = createAdminClient();
  const { data: customer } = await supabase
    .from('bol_customers')
    .select('id, seller_name, bol_client_id, bol_client_secret')
    .eq('id', 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8')
    .single();

  if (!customer) {
    console.error('❌ Customer not found');
    process.exit(1);
  }

  console.log(`Customer: ${customer.seller_name}`);
  console.log('');

  // Haal OAuth token op
  console.log('📡 Getting OAuth token...');
  const token = await getBolToken(
    customer.bol_client_id as string,
    customer.bol_client_secret as string
  );
  console.log('✓ Token acquired');
  console.log('');

  // Test 1: MONTH (default)
  console.log('─'.repeat(80));
  console.log('TEST 1: MONTH period (1 period)');
  console.log('─'.repeat(80));
  console.log(`URL: https://api.bol.com/retailer/insights/search-terms?search-term=${encodeURIComponent(keyword)}&period=MONTH&number-of-periods=1`);
  console.log('');

  try {
    const result1 = await getSearchTerms(token, keyword, 'MONTH', 1);
    console.log('Response:');
    console.log(JSON.stringify(result1, null, 2));

    if (result1.searchTerms.length > 0) {
      const st = result1.searchTerms[0];
      console.log('');
      console.log(`✓ Found data for "${st.searchTerm}"`);
      console.log(`  Total: ${st.total}`);
      console.log(`  Periods: ${(st.periods ?? []).length}`);
      if (st.periods && st.periods.length > 0) {
        console.log(`  First period count: ${st.periods[0].count}`);
      }
    } else {
      console.log('⚠️  No search terms returned (empty array)');
    }
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log('TEST 2: WEEK period (26 periods)');
  console.log('─'.repeat(80));
  console.log(`URL: https://api.bol.com/retailer/insights/search-terms?search-term=${encodeURIComponent(keyword)}&period=WEEK&number-of-periods=26`);
  console.log('');

  try {
    const result2 = await getSearchTerms(token, keyword, 'WEEK', 26);
    console.log('Response:');
    console.log(JSON.stringify(result2, null, 2));

    if (result2.searchTerms.length > 0) {
      const st = result2.searchTerms[0];
      console.log('');
      console.log(`✓ Found data for "${st.searchTerm}"`);
      console.log(`  Total: ${st.total}`);
      console.log(`  Periods returned: ${(st.periods ?? []).length}`);

      if (st.periods && st.periods.length > 0) {
        console.log('');
        console.log('  Period breakdown (first 5 weeks):');
        st.periods.slice(0, 5).forEach((p, i) => {
          console.log(`    Week ${i}: ${p.count} searches`);
        });

        const nonZero = st.periods.filter(p => p.count > 0).length;
        console.log('');
        console.log(`  Weeks with data: ${nonZero}/${st.periods.length}`);
      }
    } else {
      console.log('⚠️  No search terms returned (empty array)');
    }
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
  }

  console.log('');
  console.log('─'.repeat(80));
  console.log('TEST 3: Sample from master list');
  console.log('─'.repeat(80));

  // Haal 5 sample keywords op die nog niet gebackfilld zijn
  const { data: samples } = await supabase
    .from('bol_keyword_master')
    .select('keyword')
    .eq('bol_customer_id', customer.id)
    .eq('backfill_complete', false)
    .eq('is_brand_term', false)
    .limit(5);

  if (samples && samples.length > 0) {
    console.log('Testing 5 keywords from master list:');
    console.log('');

    for (const sample of samples) {
      const kw = sample.keyword as string;
      try {
        const result = await getSearchTerms(token, kw, 'WEEK', 26);
        const hasData = result.searchTerms.length > 0;
        const periods = hasData ? (result.searchTerms[0].periods ?? []).length : 0;
        const nonZero = hasData
          ? result.searchTerms[0].periods?.filter(p => p.count > 0).length ?? 0
          : 0;

        console.log(`  "${kw}"`);
        console.log(`    Result: ${hasData ? '✓ Data found' : '⚠️  Empty'}`);
        if (hasData) {
          console.log(`    Periods: ${periods}, Non-zero: ${nonZero}`);
          console.log(`    Total: ${result.searchTerms[0].total}`);
        }
        console.log('');
      } catch (err) {
        console.log(`  "${kw}"`);
        console.log(`    Result: ❌ Error - ${(err as Error).message}`);
        console.log('');
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  } else {
    console.log('No pending keywords found in master list');
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
