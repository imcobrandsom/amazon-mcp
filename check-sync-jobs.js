/**
 * Check if competitor sync jobs exist and if they have errors
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ioipgwwbxxeyhthfislc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvaXBnd3dieHhleWh0aGZpc2xjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzODI5MywiZXhwIjoyMDg3NjE0MjkzfQ.rzyuJBklH2IBF5H0VJ3PWdon8Qwi7vC-MwMuPoCKhtI';
const CUSTOMER_ID = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('📊 Checking sync jobs...\n');

  const { data: jobs } = await supabase
    .from('bol_sync_jobs')
    .select('*')
    .eq('bol_customer_id', CUSTOMER_ID)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!jobs || jobs.length === 0) {
    console.log('❌ No sync jobs found at all!\n');
    return;
  }

  console.log(`Found ${jobs.length} sync jobs:\n`);

  for (const job of jobs) {
    console.log(`ID: ${job.id}`);
    console.log(`Type: ${job.sync_type}`);
    console.log(`Status: ${job.status}`);
    console.log(`Created: ${job.created_at}`);
    console.log(`Completed: ${job.completed_at || 'N/A'}`);
    if (job.error) {
      console.log(`❌ ERROR: ${job.error}`);
    }
    console.log('---\n');
  }
}

main().catch(console.error);
