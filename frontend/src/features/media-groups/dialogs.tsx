import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button, Dialog as UiDialog } from '../../components/ui';
import { ApiError, deleteGroup, GROUP_NAME_MAX, getGroup, getGroupDeleteImpact, createGroup, renameGroup, type GroupDeleteImpact, type MediaGroup } from './api';

/**
 * 媒體、影像、事件、日誌、訂單紀錄共用的對話框與按鈕：全部改由系統元件（components/ui）實作，
 * 保留這些名稱與參數讓既有畫面不用改呼叫方式。新程式請直接用 components/ui 的 Dialog、Button。
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
  return (
    <UiDialog
      title={title}
      icon={icon}
      widthClassName={width}
      onClose={onClose ?? (() => {})}
      busy={!onClose}
      hideClose={!onClose}
      footer={footer}
    >
      {children}
    </UiDialog>
  );
}

/** 對話框的主要按鈕（superior／filled；danger＝danger／filled） */
export function PrimaryButton({ children, disabled, onClick, danger }: { children: ReactNode; disabled?: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <Button hierarchy={danger ? 'danger' : 'superior'} variant="filled" disabled={disabled} onPress={onClick}>
      {children}
    </Button>
  );
}

/** 對話框的取消／關閉按鈕（subordinate／tonal） */
export function GhostButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button hierarchy="subordinate" variant="tonal" disabled={disabled} onPress={onClick}>
      {children}
    </Button>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
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
    <div role="status" aria-live="polite" className={`fixed bottom-8 left-1/2 z-[260] -translate-x-1/2 rounded-xl px-5 py-3 text-body-s text-text-primary shadow-2xl ${tone === 'success' ? 'bg-status-success-emphasis' : 'bg-link-danger-filled'}`}>
      {text}
    </div>
  );
}
