import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const auth = useAuth();
  const [account, setAccount] = useState('syncdrive');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = /^[A-Za-z0-9._-]{3,64}$/.test(account.trim()) && password.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await auth.login(account.trim(), password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登入失敗，請確認帳號與密碼');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sub-background px-5 text-text-primary">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,var(--surface-theme),transparent_38%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-border-quaternary bg-surface-primary p-8 shadow-2xl shadow-black-30" aria-labelledby="login-title">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-11" />
          <div><div className="text-headline-3">VTMS</div><div className="text-body-s text-text-quaternary">SyncDrive 管理系統</div></div>
        </div>
        <h1 id="login-title" className="text-headline-4">登入系統</h1>
        <p className="mt-2 text-body-s text-text-quaternary">請使用系統管理員提供的帳號與密碼。</p>
        <form onSubmit={submit} className="mt-7 space-y-5">
          <label className="block text-body-s text-text-secondary">帳號
            <input autoFocus autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} className="mt-2 w-full rounded-xl border border-transparent bg-surface-secondary px-4 py-3.5 outline-none placeholder:text-text-quaternary focus:border-border-theme" placeholder="請輸入帳號" />
          </label>
          <label className="block text-body-s text-text-secondary">密碼
            <span className="relative mt-2 block">
              <input autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} type={show ? 'text' : 'password'} className="w-full rounded-xl border border-transparent bg-surface-secondary px-4 py-3.5 pr-12 outline-none placeholder:text-text-quaternary focus:border-border-theme" placeholder="請輸入密碼" />
              <button type="button" onClick={() => setShow((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-text-quaternary hover:text-text-primary" aria-label={show ? '隱藏密碼' : '顯示密碼'}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
            </span>
          </label>
          {error ? <p role="alert" className="rounded-xl border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">{error}</p> : null}
          <Button type="submit" hierarchy="superior" variant="filled" block disabled={!valid || busy} leadingIcon={<LogIn />}>
            {busy ? '登入中…' : '登入'}
          </Button>
        </form>
      </section>
    </main>
  );
}
