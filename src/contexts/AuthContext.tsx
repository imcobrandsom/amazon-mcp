import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { User, UserRole } from '../types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: UserRole | null;
  roleLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ALLOWED_DOMAIN = 'folloagency.com';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  const buildUser = useCallback((s: Session, userRole: UserRole): User => {
    const meta = s.user.user_metadata ?? {};
    return {
      id: s.user.id,
      email: s.user.email ?? '',
      full_name: (meta.full_name as string) || (meta.name as string) || undefined,
      avatar_url: (meta.avatar_url as string) || undefined,
      role: userRole,
    };
  }, []);

  const enforceEmailDomain = useCallback(
    async (s: Session | null) => {
      if (!s) {
        setSession(null);
        setUser(null);
        setRole(null);
        return;
      }
      const email = s.user.email ?? '';
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setRole(null);
        alert(
          `Access restricted to @${ALLOWED_DOMAIN} accounts. Please sign in with your Follo email.`
        );
        return;
      }
      setSession(s);

      // Fetch user role via API (using service role to bypass RLS issues)
      let fetchedRole: UserRole = 'academy';

      // TEMPORARY: Hardcode admin for specific email (until DB is properly set up)
      if (email === 'imco.vanelk@folloagency.com') {
        fetchedRole = 'admin';
        console.log('[AuthContext] Hardcoded admin role for:', email);
      } else {
        try {
          const response = await fetch(`/api/user-role?userId=${s.user.id}`);

          if (response.ok) {
            const data = await response.json();
            fetchedRole = data.role as UserRole;
          } else {
            console.warn('[AuthContext] Failed to fetch role from API, using default:', response.status);
            const errorData = await response.json().catch(() => ({}));
            console.warn('[AuthContext] Error details:', errorData);
          }
        } catch (error) {
          console.error('[AuthContext] Error fetching role:', error);
        }
      }

      console.log('[AuthContext] User ID:', s.user.id);
      console.log('[AuthContext] Fetched role:', fetchedRole);

      setRole(fetchedRole);
      setUser(buildUser(s, fetchedRole));
    },
    [buildUser]
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      enforceEmailDomain(s).finally(() => setLoading(false));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      enforceEmailDomain(s);
    });

    return () => subscription.unsubscribe();
  }, [enforceEmailDomain]);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: {
          hd: ALLOWED_DOMAIN, // Google hosted domain hint
        },
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
  };

  const roleLoading = session !== null && role === null;

  return (
    <AuthContext.Provider
      value={{ session, user, loading, role, roleLoading, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
