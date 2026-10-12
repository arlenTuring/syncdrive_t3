import { AlertCircle, Eye, EyeOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createAccount, fetchRoleOptions, resetPassword, type AccountRow, type RoleSummary } from './api';
import { dangerClass, fieldClass, Modal, passwordValid, primaryClass } from './Modal';

export function CreateAccountDialog({ onClose, onSaved, onOpenRoles }: { onClose: () => void; onSaved: () => void; onOpenRoles: () => void }) {
  const [accountName, setAccountName] = useState(''); const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(''); const [show, setShow] = useState(false);
  const [roles, setRoles] = useState<RoleSummary[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void fetchRoleOptions().then(setRoles).catch((e: Error) => setError(e.message)).finally(() => setLoadingRoles(false)); }, []);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current);
  const valid = /^[A-Za-z0-9._-]{3,64}$/.test(accountName.trim()) && Boolean(displayName.trim()) && passwordValid(password) && selected.length >= 1 && selected.length <= 3;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!valid) return; setBusy(true); setError(''); try { await createAccount({ account_name: accountName.trim(), display_name: displayName.trim(), password, role_ids: selected }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : '建立失敗'); setBusy(false); } };
  return <Modal title="建立帳號" onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="flex min-h-0 flex-col overflow-hidden"><div className="space-y-4 overflow-y-auto px-7 pb-6">
      <label className="block text-zinc-300"><b className="text-red-400">*</b>帳號名稱<input className={fieldClass} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="3–64 字元，可使用英數、. _ -" /></label>
      <label className="block text-zinc-300"><b className="text-red-400">*</b>使用者姓名<input className={fieldClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label className="block text-zinc-300"><b className="text-red-400">*</b>密碼<span className="relative block"><input className={`${fieldClass} pr-12`} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="至少 8 個字元，需含大小寫字母及數字" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-zinc-400" aria-label={show ? '隱藏密碼' : '顯示密碼'}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></span></label>
      <fieldset><legend className="text-zinc-300"><b className="text-red-400">*</b>綁定角色 <span className="text-xs text-zinc-500">（1–3 個）</span></legend>
        <div className="mt-2 rounded-xl bg-[#232933] p-3">{loadingRoles ? <p className="text-sm text-zinc-500">載入角色中…</p> : roles.length ? <div className="space-y-2">{roles.map((role) => <label key={role.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${!selected.includes(role.id) && selected.length >= 3 ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-white/5'}`}><input type="checkbox" checked={selected.includes(role.id)} disabled={!selected.includes(role.id) && selected.length >= 3} onChange={() => toggle(role.id)} /><span>{role.name}</span><code className="ml-auto text-xs text-zinc-500">{role.code}</code></label>)}</div> : <div className="text-sm text-zinc-400">尚無可選角色。<button type="button" onClick={onOpenRoles} className="ml-2 text-sky-400 hover:underline">前往角色設定</button></div>}</div>
        {selected.length ? <div className="mt-2 flex flex-wrap gap-2">{selected.map((id) => { const role = roles.find((item) => item.id === id); return role ? <button type="button" key={id} onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-lg bg-zinc-700 px-2.5 py-1 text-sm text-zinc-100">{role.name}<X className="size-3" /></button> : null; })}</div> : null}
      </fieldset>
      {error ? <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
    </div><footer className="flex justify-end gap-3 border-t border-zinc-700 px-7 py-5"><button type="button" disabled={busy} onClick={onClose} className="px-5 py-2.5 text-zinc-300">取消</button><button className={primaryClass} disabled={!valid || busy}>{busy ? '建立中…' : '建立'}</button></footer></form>
  </Modal>;
}

export function ResetPasswordDialog({ account, onClose, onSaved }: { account: AccountRow; onClose: () => void; onSaved: () => void }) {
  const [password, setPasswordValue] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const valid = passwordValid(password) && password === confirm;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await resetPassword(account.id, password); setPasswordValue(''); setConfirm(''); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : '重設失敗'); setBusy(false); } };
  return <Modal title={`重設密碼 · ${account.account_name}`} onClose={onClose} busy={busy}><form onSubmit={submit} className="flex flex-col"><div className="space-y-4 px-7 pb-6">
    {['新密碼', '確認新密碼'].map((label, index) => <label key={label} className="block text-zinc-300"><b className="text-red-400">*</b>{label}<span className="relative block"><input className={`${fieldClass} pr-12`} type={show ? 'text' : 'password'} value={index ? confirm : password} onChange={(e) => index ? setConfirm(e.target.value) : setPasswordValue(e.target.value)} autoComplete="new-password" placeholder="至少 8 個字元，需含大小寫字母及數字" />{index === 0 ? <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-zinc-400" aria-label={show ? '隱藏密碼' : '顯示密碼'}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button> : null}</span></label>)}
    {confirm && password !== confirm ? <p className="text-sm text-red-300">兩次密碼不一致</p> : null}{error ? <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
  </div><footer className="flex justify-end gap-3 border-t border-zinc-700 px-7 py-5"><button type="button" onClick={onClose} className="px-5 text-zinc-300">取消</button><button className={primaryClass} disabled={!valid || busy}>{busy ? '儲存中…' : '儲存'}</button></footer></form></Modal>;
}

export function DeleteAccountDialog({ account, onClose, onDeleted }: { account: AccountRow; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="刪除帳號" onClose={onClose} busy={busy}><div className="px-7 pb-6"><AlertCircle className="mb-5 size-12 rounded-full bg-red-500/15 p-2 text-red-500" /><p className="text-lg text-zinc-100">確定要刪除「{account.account_name}」嗎？</p><p className="mt-3 text-zinc-400">刪除後無法復原，請再次確認。</p>{error ? <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}</div><footer className="flex justify-end gap-3 border-t border-zinc-700 px-7 py-5"><button type="button" onClick={onClose} className="px-5 text-zinc-300">取消</button><button type="button" className={dangerClass} disabled={busy} onClick={() => { setBusy(true); setError(''); void onDeleted().catch((reason) => { setError(reason instanceof Error ? reason.message : '刪除失敗'); setBusy(false); }); }}>{busy ? '刪除中…' : '刪除'}</button></footer></Modal>;
}
