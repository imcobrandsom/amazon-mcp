import { createClient } from '@supabase/supabase-js';

// Server-side client using the service key (bypasses RLS where needed)
export function createAdminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
