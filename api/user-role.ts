import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminClient } from './_lib/supabase-admin';

/**
 * GET /api/user-role
 * Returns the role for the authenticated user
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the session token from the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const supabase = createAdminClient();

    // Verify the token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('[user-role] Auth error:', authError);
      return res.status(401).json({ error: 'Unauthorized', details: authError?.message });
    }

    console.log('[user-role] Authenticated user:', user.id);

    // Fetch user role
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

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
