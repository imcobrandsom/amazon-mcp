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

      // Fetch user role from user_profiles table
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', s.user.id)
        .single();

      // Debug logging
      console.log('[AuthContext] User ID:', s.user.id);
      console.log('[AuthContext] Profile data:', profileData);
      console.log('[AuthContext] Profile error:', profileError);

      const fetchedRole: UserRole = (profileData?.role as UserRole) ?? 'academy';
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
