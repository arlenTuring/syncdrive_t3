import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import {fieldClass, Modal } from './Modal';
import { Button, IconButton } from '../../components/ui';

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
      <div className="space-y-4 overflow-y-auto px-6 pb-6">
        <label className="block text-text-secondary">帳號名稱<input className={fieldClass} value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="username" /></label>
        <label className="block text-text-secondary">密碼<span className="relative block"><input className={`${fieldClass} pr-12`} value={password} onChange={(e) => setPassword(e.target.value)} type={show ? 'text' : 'password'} autoComplete="current-password" /><IconButton size="small" hierarchy="subordinate" variant="standard" className="absolute right-0 top-1/2 mt-1 -translate-y-1/2" label={show ? '隱藏密碼' : '顯示密碼'} icon={show ? <EyeOff /> : <Eye />} onPress={() => setShow(!show)} /></span></label>
        {error ? <p role="alert" className="rounded-lg bg-status-error-light p-3 text-body-s text-status-error-emphasis">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4"><Button hierarchy="subordinate" variant="tonal" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" hierarchy="superior" variant="filled" disabled={!valid || busy}>{busy ? '處理中…' : '登入'}</Button></footer>
    </form>
  </Modal>;
}
