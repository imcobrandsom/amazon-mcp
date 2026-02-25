import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { User } from '../types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ALLOWED_DOMAIN = 'folloagency.com';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const buildUser = useCallback((s: Session): User => {
    const meta = s.user.user_metadata ?? {};
    return {
      id: s.user.id,
      email: s.user.email ?? '',
      full_name: (meta.full_name as string) || (meta.name as string) || undefined,
      avatar_url: (meta.avatar_url as string) || undefined,
    };
  }, []);

  const enforceEmailDomain = useCallback(
    async (s: Session | null) => {
      if (!s) {
        setSession(null);
        setUser(null);
        return;
      }
      const email = s.user.email ?? '';
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        alert(
          `Access restricted to @${ALLOWED_DOMAIN} accounts. Please sign in with your Follo email.`
        );
        return;
      }
      setSession(s);
      setUser(buildUser(s));
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
  };

  return (
    <AuthContext.Provider
      value={{ session, user, loading, signInWithGoogle, signOut }}
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
