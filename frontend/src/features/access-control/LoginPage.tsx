import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
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
    <main className="flex min-h-screen items-center justify-center bg-black px-5 text-zinc-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(37,99,235,0.12),transparent_38%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-zinc-800 bg-[#151619] p-8 shadow-2xl shadow-blue-950/20" aria-labelledby="login-title">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-11" />
          <div><div className="text-2xl font-semibold tracking-wide">VTMS</div><div className="text-sm text-zinc-500">SyncDrive 管理系統</div></div>
        </div>
        <h1 id="login-title" className="text-xl font-semibold">登入系統</h1>
        <p className="mt-2 text-sm text-zinc-500">請使用系統管理員提供的帳號與密碼。</p>
        <form onSubmit={submit} className="mt-7 space-y-5">
          <label className="block text-sm text-zinc-300">帳號
            <input autoFocus autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} className="mt-2 w-full rounded-xl border border-transparent bg-[#232933] px-4 py-3.5 outline-none placeholder:text-zinc-600 focus:border-blue-500" placeholder="請輸入帳號" />
          </label>
          <label className="block text-sm text-zinc-300">密碼
            <span className="relative mt-2 block">
              <input autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} type={show ? 'text' : 'password'} className="w-full rounded-xl border border-transparent bg-[#232933] px-4 py-3.5 pr-12 outline-none placeholder:text-zinc-600 focus:border-blue-500" placeholder="請輸入密碼" />
              <button type="button" onClick={() => setShow((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-500 hover:text-white" aria-label={show ? '隱藏密碼' : '顯示密碼'}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
            </span>
          </label>
          {error ? <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}
          <button type="submit" disabled={!valid || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-medium transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
            <LogIn className="size-5" />{busy ? '登入中…' : '登入'}
          </button>
        </form>
      </section>
    </main>
  );
}
