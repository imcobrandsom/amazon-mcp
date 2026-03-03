/**
 * Check bol_category_insights table
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('🔍 Checking bol_category_insights...\n');

  const { data: insights } = await supabase
    .from('bol_category_insights')
    .select('*')
    .eq('bol_customer_id', CUSTOMER_ID)
    .order('generated_at', { ascending: false });

  console.log(`Total insights: ${insights?.length || 0}\n`);

  if (insights && insights.length > 0) {
    for (const insight of insights) {
      console.log(`Category: ${insight.category_name || insight.category_slug}`);
      console.log(`  ID: ${insight.category_id}`);
      console.log(`  Competitor count: ${insight.competitor_count || 0}`);
      console.log(`  Avg price: €${insight.avg_price || 'N/A'}`);
      console.log(`  Generated: ${insight.generated_at}`);

      if (insight.trending_keywords) {
        const keywords = insight.trending_keywords;
        console.log(`  Keywords: ${keywords.length} found`);
      }

      console.log('');
    }
  } else {
    console.log('❌ NO INSIGHTS FOUND!');
    console.log('   This is why the Competitor Research UI shows no data.\n');
  }

  // Also check content analysis
  console.log('📊 Checking bol_competitor_content_analysis...\n');

  const { count: analysisCount } = await supabase
    .from('bol_competitor_content_analysis')
    .select('*', { count: 'exact', head: true })
    .eq('bol_customer_id', CUSTOMER_ID);

  console.log(`Total content analysis records: ${analysisCount || 0}\n`);

  if (analysisCount && analysisCount > 0) {
    const { data: analysisSamples } = await supabase
      .from('bol_competitor_content_analysis')
      .select('category_slug, competitor_ean, title_score, description_score')
      .eq('bol_customer_id', CUSTOMER_ID)
      .limit(5);

    console.log('Sample analysis records:');
    for (const sample of analysisSamples || []) {
      console.log(`  ${sample.category_slug}: ${sample.competitor_ean}`);
      console.log(`    Title score: ${sample.title_score || 'N/A'}`);
      console.log(`    Desc score: ${sample.description_score || 'N/A'}`);
    }
    console.log('');
  }
}

main().catch(console.error);
