import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { fieldClass, Modal, primaryClass } from './Modal';

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await auth.login(account, password); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '登入失敗'); setBusy(false); }
  };
  const valid = /^[A-Za-z0-9._-]{3,64}$/.test(account.trim()) && password.length > 0;
  return <Modal title="登入" onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="flex min-h-0 flex-col overflow-hidden">
      <div className="space-y-4 overflow-y-auto px-7 pb-6">
        <label className="block text-zinc-300">帳號名稱<input className={fieldClass} value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="username" /></label>
        <label className="block text-zinc-300">密碼<span className="relative block"><input className={`${fieldClass} pr-12`} value={password} onChange={(e) => setPassword(e.target.value)} type={show ? 'text' : 'password'} autoComplete="current-password" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-zinc-400" aria-label={show ? '隱藏密碼' : '顯示密碼'}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></span></label>
        {error ? <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-3 border-t border-zinc-700 px-7 py-5"><button type="button" onClick={onClose} disabled={busy} className="px-5 py-2.5 text-zinc-300">取消</button><button className={primaryClass} disabled={!valid || busy}>{busy ? '處理中…' : '登入'}</button></footer>
    </form>
  </Modal>;
}
