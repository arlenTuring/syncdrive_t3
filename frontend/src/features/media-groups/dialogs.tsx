import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, deleteGroup, GROUP_NAME_MAX, getGroup, getGroupDeleteImpact, createGroup, renameGroup, type GroupDeleteImpact, type MediaGroup } from './api';

/** 開著的對話框（後開的在最後）：只有最上層處理 Escape／Tab，子對話框不會連帶關掉主對話框 */
const openDialogs: symbol[] = [];

/**
 * 深色對話框（依設計稿）：Escape 關閉、開啟時聚焦第一個欄位、Tab 不跑出對話框、關閉後焦點回到開啟它的按鈕。
 */
export function Dialog({
  title,
  icon,
  width = 'max-w-md',
  onClose,
  children,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  width?: string;
  /** 不給就不能關（送出中） */
  onClose?: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const self = Symbol('dialog');
    openDialogs.push(self);
    const first = panel.current?.querySelector<HTMLElement>('input:not([type=checkbox]), [data-autofocus], button:not([aria-label="關閉"])');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== self) return;
      // 日期時間等浮動面板開著時，Escape 先交給它關閉
      if (document.querySelector('[data-anchored-popover]')) return;
      if (event.key === 'Escape') {
        // 拿起中的拖曳項目等自己處理 Escape（取消移動），不關閉對話框
        if ((document.activeElement as HTMLElement | null)?.closest?.('[data-captures-escape="true"]')) return;
        event.stopPropagation();
        closeRef.current?.();
      } else if (event.key === 'Tab' && panel.current) {
        const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        if (!focusable.length) return;
        const [head, tail] = [focusable[0], focusable[focusable.length - 1]];
        if (event.shiftKey && document.activeElement === head) {
          event.preventDefault();
          tail.focus();
        } else if (!event.shiftKey && document.activeElement === tail) {
          event.preventDefault();
          head.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      openDialogs.splice(openDialogs.indexOf(self), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-3xl bg-[#1b1b1f] shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 px-8 pt-8">
          <div>
            {icon}
            <h2 id={titleId} className="text-2xl font-semibold text-zinc-100">{title}</h2>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="關閉" className="rounded-lg p-1 text-zinc-300 hover:bg-white/10">
              <X className="size-7" />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 overflow-y-auto px-8 pt-5 pb-6">{children}</div>
        <div className="flex justify-end gap-3 border-t border-zinc-700/70 px-8 py-6">{footer}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({ children, disabled, onClick, danger }: { children: ReactNode; disabled?: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl px-7 py-3 text-lg font-medium disabled:bg-[#262a33] disabled:text-zinc-500 ${danger ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-xl px-6 py-3 text-lg text-zinc-200 hover:bg-white/5 disabled:opacity-50">
      {children}
    </button>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  );
}

/**
 * 建立／編輯分組（只改名稱）。編輯時開啟先取最新資料（名稱與版本），成員不經過這個表單，
 * 後端也只改名稱，所以不會把別人剛加入的成員覆蓋掉。
 */
export function GroupNameDialog({ groupId, onClose, onSaved }: { groupId?: string; onClose: () => void; onSaved: (group: MediaGroup, created: boolean) => void }) {
  const [name, setName] = useState('');
  const [original, setOriginal] = useState<MediaGroup | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fieldId = useId();
  useEffect(() => {
    if (!groupId) return;
    void getGroup(groupId)
      .then((group) => {
        setOriginal(group);
        setName(group.name);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [groupId]);
  const trimmed = name.trim();
  const invalid = !trimmed ? '請輸入分組名稱' : trimmed.length > GROUP_NAME_MAX ? `最多 ${GROUP_NAME_MAX} 字` : null;
  const unchanged = Boolean(original) && trimmed === original!.name;
  const canSubmit = !invalid && !unchanged && !saving && !loading && (!groupId || Boolean(original));
  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const saved = groupId ? await renameGroup(groupId, trimmed, original!.version) : await createGroup(trimmed);
      onSaved(saved, !groupId);
    } catch (reason) {
      // 失敗保留輸入
      setError(reason instanceof ApiError && reason.status === 409 && groupId ? `${reason.message}（請關閉後重新開啟編輯）` : (reason as Error).message);
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={groupId ? '編輯分組' : '建立分組'}
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton disabled={!canSubmit} onClick={() => void submit()}>{saving ? '處理中…' : groupId ? '儲存' : '建立'}</PrimaryButton>
        </>
      }
    >
      <label htmlFor={fieldId} className="mb-2 block text-lg text-zinc-300">
        <span className="text-red-400">*</span>分組名稱
      </label>
      <input
        id={fieldId}
        value={name}
        disabled={loading}
        maxLength={GROUP_NAME_MAX + 20}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && void submit()}
        placeholder={loading ? '載入中…' : '請輸入'}
        aria-invalid={Boolean(name) && Boolean(invalid)}
        className="w-full rounded-xl bg-[#262a33] px-5 py-4 text-lg text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-blue-500"
      />
      <div className="mt-1 flex justify-between text-xs text-zinc-500">
        <span className="text-amber-300">{name && invalid ? invalid : ''}</span>
        <span>{trimmed.length}/{GROUP_NAME_MAX}</span>
      </div>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}

/** 刪除分組：先查引用，有引用就列出位置並阻擋；確認時後端再檢查一次 */
export function DeleteGroupDialog({ groupId, onClose, onDeleted }: { groupId: string; onClose: () => void; onDeleted: () => void }) {
  const [impact, setImpact] = useState<GroupDeleteImpact | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getGroupDeleteImpact(groupId).then(setImpact).catch((reason: Error) => setError(reason.message));
  }, [groupId]);
  const remove = async () => {
    if (!impact?.allowed || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteGroup(groupId, impact.version);
      onDeleted();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
      // 可能是剛被加上引用：重新取得預覽
      void getGroupDeleteImpact(groupId).then(setImpact).catch(() => undefined);
    }
  };
  return (
    <Dialog
      title="確定刪除此分組？"
      icon={<Trash2 className="mb-4 size-10 text-red-500" aria-hidden />}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>取消</GhostButton>
          <PrimaryButton danger disabled={!impact?.allowed || busy} onClick={() => void remove()}>{busy ? '刪除中…' : '刪除'}</PrimaryButton>
        </>
      }
    >
      {impact ? <p className="mb-2 text-lg text-zinc-100">「{impact.name}」{impact.member_count ? `（${impact.member_count} 個媒體）` : '（空分組）'}</p> : <p className="text-zinc-400">正在檢查引用…</p>}
      <p className="text-lg text-zinc-400">刪除後無法復原，但不會影響原始媒體檔案。</p>
      {impact && impact.references.length ? (
        <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          <p className="mb-1">此分組仍被以下設定引用，請先解除引用再刪除：</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {impact.references.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>{ref.kind_label}：{ref.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}

export function Toast({ text, tone = 'success' }: { text: string; tone?: 'success' | 'error' }) {
  return (
    <div role="status" aria-live="polite" className={`fixed bottom-8 left-1/2 z-[260] -translate-x-1/2 rounded-xl px-5 py-3 text-white shadow-2xl ${tone === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {text}
    </div>
  );
}
