import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { deleteSchedule, getScheduleResults, type MediaSchedule, type ScheduleResult } from './api';
import { formatInZone } from './draft';

/** 刪除：只停止之後的播放；不刪媒體、分組、檔案與到期紀錄，也不對車端送停止指令 */
export function DeleteScheduleDialog({ schedule, onClose, onDeleted }: { schedule: MediaSchedule; onClose: () => void; onDeleted: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await deleteSchedule(schedule.id, schedule.version);
      onDeleted();
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="刪除媒體排程"
      icon={<AlertTriangle className="mb-3 size-10 text-red-500" aria-hidden />}
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton danger disabled={saving} onClick={() => void submit()}>{saving ? '刪除中…' : '刪除'}</PrimaryButton>
        </>
      }
    >
      <p className="text-lg text-zinc-100">確定要刪除「{schedule.name}」？</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-400">
        <li>刪除後這個排程不會再有任何後續播放。</li>
        <li>不會刪除媒體、媒體分組或檔案，已到期的處理紀錄會保留。</li>
        <li>不會對載具送出停止播放指令；正在播放中的內容不受影響。</li>
      </ul>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}

const BATCH_LABEL: Record<string, string> = {
  awaiting_integration: '已到期，待下發（車端媒體播放介接尚未就緒）',
  missed: '錯過（超過容許時間未處理，不補播）',
  content_invalid: '播放清單內容無效，未下發',
  no_targets: '沒有可用載具',
};
const DELIVERY_LABEL: Record<string, string> = {
  not_delivered: '未下發',
  skipped_offline: '離線略過',
  skipped_removed: '載具已移除',
  content_invalid: '內容無效',
};

/** 最近的到期結果：只代表「到期判定與處理」，不是實際播放紀錄（車端沒有回報契約） */
export function ScheduleResultsDialog({ schedule, onClose }: { schedule: MediaSchedule; onClose: () => void }) {
  const [items, setItems] = useState<ScheduleResult[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getScheduleResults(schedule.id)
      .then((result) => setItems(result.items))
      .catch((reason: Error) => setError(reason.message));
  }, [schedule.id]);
  return (
    <Dialog title={`到期處理結果：${schedule.name}`} width="max-w-3xl" onClose={onClose} footer={<GhostButton onClick={onClose}>關閉</GhostButton>}>
      <p className="mb-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        這裡是後端到期判定的結果，不是實際播放紀錄。車端尚無媒體播放指令與回報契約，目前不會下發，也不會顯示「已播放」。
      </p>
      {error ? <ErrorLine text={error} /> : !items ? <p className="py-10 text-center text-zinc-500">載入中…</p> : !items.length ? <p className="py-10 text-center text-zinc-500">尚未有到期紀錄</p> : null}
      <ul className="space-y-3">
        {items?.map((batch) => (
          <li key={batch.id} className="rounded-xl bg-[#232730] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-zinc-100">{formatInZone(batch.scheduled_at, schedule.time_zone)}</span>
              <span className="text-sm text-zinc-400">{BATCH_LABEL[batch.status] ?? batch.status}</span>
              {batch.detail.missed_count ? <span className="text-xs text-zinc-500">期間略過 {batch.detail.missed_count} 個時點</span> : null}
            </div>
            {batch.deliveries.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {batch.deliveries.map((delivery) => (
                  <li key={delivery.vehicle_id} className="flex gap-3">
                    <span className="w-32 truncate text-zinc-200" title={delivery.vehicle_code}>{delivery.vehicle_name}</span>
                    <span className="w-24 text-zinc-400">{DELIVERY_LABEL[delivery.status] ?? delivery.status}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500" title={delivery.reason}>{delivery.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
