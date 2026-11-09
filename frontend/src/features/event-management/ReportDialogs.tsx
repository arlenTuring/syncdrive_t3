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
        icon={<span className="mb-4 flex size-10 items-center justify-center rounded-full bg-amber-400 text-2xl font-bold text-[#1b1b1f]" aria-hidden>!</span>}
        width="max-w-xl"
        onClose={busy ? undefined : onClose}
        footer={
          <>
            <GhostButton disabled={busy} onClick={() => { setError(''); setStep('edit'); }}>返回修改</GhostButton>
            <PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '確認回報'}</PrimaryButton>
          </>
        }
      >
        <p className="flex items-center gap-2 text-sm font-medium text-amber-400">
          <AlertTriangle className="size-5 shrink-0" />
          注意：回報送出後將同步至系統，無法再進行修改或撤回！
        </p>
        <dl className="mt-5 space-y-4 rounded-2xl bg-[#222329] px-5 py-4 text-sm">
          <div className="grid grid-cols-[7rem_1fr] items-center"><dt className="text-zinc-400">嚴重度</dt><dd><SeverityBadge severity={event.severity} /></dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-zinc-400">載具編號</dt><dd>{event.vehicleCode ?? event.sourceName ?? '—'}</dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-zinc-400">事件類型</dt><dd>{event.eventLabel}</dd></div>
          <div className="grid grid-cols-[7rem_1fr]"><dt className="text-zinc-400">事件編號</dt><dd className="tabular-nums">{event.id}</dd></div>
          <div className="grid grid-cols-[7rem_1fr] border-t border-zinc-700 pt-4"><dt className="text-zinc-400">回報內容</dt><dd className="break-words whitespace-pre-wrap">{trimmed}</dd></div>
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
      <div className="rounded-2xl border border-[#2c3e55] bg-[#1f2128] px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-3 text-sm"><SeverityBadge severity={event.severity} />{event.vehicleCode ?? event.sourceName ?? '—'}</span>
          <span className="text-xs text-zinc-300">#事件編號 {event.id}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm">{event.eventLabel}</span>
          <span className="text-xs tabular-nums text-zinc-400">{formatDateTime(event.occurredAt, timeZone)}</span>
        </div>
      </div>
      <label className="mt-6 block">
        <span className="mb-2 block px-1 text-sm text-zinc-400">回報內容</span>
        <textarea
          data-autofocus
          rows={3}
          value={note}
          onChange={(input) => setNote([...input.target.value].slice(0, REPORT_NOTE_MAX).join(''))}
          placeholder="請輸入"
          aria-label={`事件 ${event.id} 回報內容`}
          className="w-full resize-y rounded-lg bg-[#232730] px-3 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500"
        />
        <span className="mt-1 block px-1 text-xs text-zinc-400">{length(note)}/{REPORT_NOTE_MAX}</span>
      </label>
    </Dialog>
  );
}
