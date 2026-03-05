import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin.js';

/**
 * GET /api/user-role?userId=xxx
 * Returns the role for the specified user (admin client bypasses RLS)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }

    const supabase = createAdminClient();

    // Fetch user role using service role (bypasses RLS)
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    console.log('[user-role] User ID:', userId);
    console.log('[user-role] Profile data:', profile);
    console.log('[user-role] Profile error:', profileError);

    if (profileError) {
      console.error('[user-role] Error fetching profile:', profileError);
      return res.status(500).json({
        error: 'Failed to fetch role',
        details: profileError.message,
        code: profileError.code
      });
    }

    const role = (profile?.role as 'admin' | 'academy') ?? 'academy';
    console.log('[user-role] Returning role:', role);

    return res.status(200).json({ role });
  } catch (err) {
    console.error('[user-role] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
