import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, login as loginApi, logout as logoutApi, type AuthUser } from './api';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (accountName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};
const Context = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try { setUser((await fetchMe()).user); } catch { setUser(null); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const value = useMemo<AuthState>(() => ({
    user, loading,
    login: async (accountName, password) => setUser(await loginApi(accountName, password)),
    logout: async () => { await logoutApi(); setUser(null); },
    refresh,
    can: (permission) => Boolean(user?.permissions.includes(permission)),
  }), [user, loading]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
