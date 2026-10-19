import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, login as loginApi, logout as logoutApi, type AuthUser } from './api';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (accountName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  require: (permission: string) => boolean;
};
const Context = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    try { setUser((await fetchMe()).user); } catch { setUser(null); } finally { setLoading(false); }
  };
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
      const headers = new Headers(request?.headers);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if (url.origin === window.location.origin && url.pathname.includes('/syncdrive-api/')) {
        const csrf = document.cookie.split('; ').find((part) => part.startsWith('syncdrive_csrf='))?.split('=').slice(1).join('=');
        if (csrf && !['GET','HEAD','OPTIONS'].includes(method)) headers.set('x-csrf-token', decodeURIComponent(csrf));
      }
      const response = await nativeFetch(input, { ...init, credentials: url.origin === window.location.origin ? 'include' : init.credentials, headers });
      // 查詢登入狀態本身失敗時不再觸發重查，避免 401 → 重查 → 401 的無限循環
      if (url.origin === window.location.origin && !url.pathname.endsWith('/syncdrive-api/auth/me') && (response.status === 401 || response.status === 403)) {
        window.dispatchEvent(new CustomEvent('syncdrive-auth-error', { detail: { status: response.status } }));
      }
      return response;
    };
    void refresh();
    const focus = () => void refresh();
    const authError = (event: Event) => {
      const detail = (event as CustomEvent<{ status: number }>).detail;
      if (detail?.status === 401) void refresh();
      if (detail?.status === 403) setNotice('權限不足');
    };
    window.addEventListener('focus', focus);
    window.addEventListener('syncdrive-auth-error', authError);
    return () => { window.fetch = nativeFetch; window.removeEventListener('focus', focus); window.removeEventListener('syncdrive-auth-error', authError); };
  }, []);
  const value = useMemo<AuthState>(() => ({
    user, loading,
    login: async (accountName, password) => setUser(await loginApi(accountName, password)),
    logout: async () => { await logoutApi(); setUser(null); },
    refresh,
    can: (permission) => Boolean(user?.permissions.includes(permission)),
    require: (permission) => {
      if (user?.permissions.includes(permission)) return true;
      setNotice('權限不足');
      return false;
    },
  }), [user, loading]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2600); return () => window.clearTimeout(timer); }, [notice]);
  return <Context.Provider value={value}>{children}{notice ? <div role="alert" className="fixed bottom-8 left-1/2 z-[200] -translate-x-1/2 rounded-xl bg-red-600 px-5 py-3 text-white shadow-2xl">{notice}</div> : null}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
