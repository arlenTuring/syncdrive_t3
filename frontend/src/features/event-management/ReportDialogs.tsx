import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { formatDateTime } from '../event-log-shared/time';
import { acknowledgeEvent, type EventDetail, type EventItem } from './api';
import { SeverityBadge } from './eventBadges';

export const REPORT_NOTE_MAX = 50;

const length = (text: string) => [...text].length;

/**
 * 事件回報兩步驟（依設計稿）：先填回報內容，按「確定」後再確認一次才送出。
 * 送出後同步至系統，不能修改或撤回；「返回修改」回到第一步並保留內容。
 */
export function ReportFlow({ event, timeZone, onClose, onReported }: { event: EventItem; timeZone: string; onClose: () => void; onReported: (result: EventDetail) => void }) {
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = note.trim();

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onReported(await acknowledgeEvent(event.id, trimmed));
    } catch (reason) {
      setError(`回報失敗：${(reason as Error).message}，可再試一次`);
      setBusy(false);
    }
  };

  if (step === 'confirm') {
    return (
      <Dialog
        title="確認送出此事件回報？"
        icon={<span className="mb-4 flex size-10 items-center justify-center rounded-full bg-status-warning text-headline-3 text-text-invert" aria-hidden>!</span>}
        width="max-w-xl"
        onClose={busy ? undefined : onClose}
        footer={
          <>
            <GhostButton disabled={busy} onClick={() => { setError(''); setStep('edit'); }}>返回修改</GhostButton>
            <PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '確認回報'}</PrimaryButton>
          </>
        }
      >
        <p className="flex items-center gap-2 text-body-s-bold text-status-warning">
          <AlertTriangle className="size-5 shrink-0" />
          注意：回報送出後將同步至系統，無法再進行修改或撤回！
        </p>
        <dl className="mt-5 space-y-4 rounded-2xl bg-surface-secondary px-5 py-4 text-body-s">
          <div className="grid grid-cols-[7rem_1fr] items-center"><dt className="text-text-tertiary">嚴重度</dt><dd><SeverityBadge severity={event.severity} /></dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-text-tertiary">載具編號</dt><dd>{event.vehicleCode ?? event.sourceName ?? '—'}</dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-text-tertiary">事件類型</dt><dd>{event.eventLabel}</dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-text-tertiary">事件編號</dt><dd className="tabular-nums">{event.id}</dd></div>
          <div className="grid grid-cols-[7rem_1fr] border-t border-border-quaternary pt-4"><dt className="text-text-tertiary">回報內容</dt><dd className="break-words whitespace-pre-wrap">{trimmed}</dd></div>
        </dl>
        {error ? <ErrorLine text={error} /> : null}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="回報"
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>取消</GhostButton>
          <PrimaryButton disabled={!trimmed || length(note) > REPORT_NOTE_MAX} onClick={() => setStep('confirm')}>確定</PrimaryButton>
        </>
      }
    >
      <div className="rounded-2xl border border-border-theme-light-trn bg-surface-theme-light px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-3 text-body-s"><SeverityBadge severity={event.severity} />{event.vehicleCode ?? event.sourceName ?? '—'}</span>
          <span className="text-body-xs text-text-secondary">#事件編號 {event.id}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-body-s">{event.eventLabel}</span>
          <span className="text-body-xs tabular-nums text-text-tertiary">{formatDateTime(event.occurredAt, timeZone)}</span>
        </div>
      </div>
      <label className="mt-6 block">
        <span className="mb-2 block px-1 text-body-s text-text-tertiary">回報內容</span>
        <textarea
          data-autofocus
          rows={3}
          value={note}
          onChange={(input) => setNote([...input.target.value].slice(0, REPORT_NOTE_MAX).join(''))}
          placeholder="請輸入"
          aria-label={`事件 ${event.id} 回報內容`}
          className="w-full resize-y rounded-lg bg-surface-secondary px-3 py-3 text-body-s text-text-primary outline-none placeholder:text-text-quaternary focus:ring-1 focus:ring-border-theme"
        />
        <span className="mt-1 block px-1 text-body-xs text-text-tertiary">{length(note)}/{REPORT_NOTE_MAX}</span>
      </label>
    </Dialog>
  );
}
