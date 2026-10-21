import { PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, ErrorLine, GhostButton } from '../media-groups/dialogs';
import { Badge, DetailRow, JsonBlock } from '../event-log-shared/ui';
import { formatDateTime } from '../event-log-shared/time';
import { fetchEvent, type EventDetail } from './api';

const SOURCE_LABEL = { VEHICLE: '載具', FACILITY: '設施', SYSTEM: '系統' } as const;
const SEVERITY_LABEL: Record<string, string> = { INFO: '資訊', WARNING: '警告', CRITICAL: '嚴重' };

/**
 * 事件詳情（三標籤共用，唯讀）。人工確認只在待確認標籤的事件列進行；
 * 這裡開啟、查看或開回放都不會寫入確認或標記已讀。最上方先顯示處理紀錄摘要，再顯示事件原始資料。
 */
export function EventDetailDialog({ id, timeZone, refreshSignal = 0, onClose, onReplay }: { id: string; timeZone: string; refreshSignal?: number; onClose: () => void; onReplay: (id: string) => void }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchEvent(id, controller.signal)
      .then(setEvent)
      .catch((reason: Error) => !controller.signal.aborted && setLoadError(reason.message));
    return () => controller.abort();
  }, [id, refreshSignal]);

  const t = (ms: number | null | undefined) => formatDateTime(ms, timeZone);
  return (
    <Dialog
      title="事件詳情"
      width="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          {event?.vehicleCode ? (
            <button type="button" onClick={() => onReplay(event.id)} className="mr-auto inline-flex items-center gap-2 rounded-xl border border-zinc-600 px-4 py-2.5 text-sm hover:bg-white/5">
              <PlayCircle className="size-4" />
              事件回放（前後 30 秒）
            </button>
          ) : (
            <span className="mr-auto self-center text-xs text-zinc-500">{event ? '非載具事件，沒有載具軌跡可回放' : ''}</span>
          )}
          <GhostButton onClick={onClose}>關閉</GhostButton>
        </>
      }
    >
      {loadError ? (
        <ErrorLine text={`載入失敗：${loadError}`} />
      ) : !event ? (
        <p className="py-10 text-center text-zinc-500">載入中…</p>
      ) : (
        <div className="space-y-5">
          <section className="rounded-xl bg-[#232730] p-4" aria-label="處理紀錄">
            <h3 className="text-sm font-medium">處理紀錄</h3>
            {event.acknowledged ? (
              <div className="mt-2 space-y-1 text-sm">
                <div>
                  <Badge tone="sky">已確認</Badge>
                  <span className="ml-2">{event.acknowledgedByName ?? '—'}・{event.acknowledgedAt ? t(event.acknowledgedAt) : '確認時間未記錄（舊資料）'}</span>
                </div>
                <div className="text-zinc-300">確認緣由：{event.acknowledgementNote || '舊資料未記錄'}</div>
              </div>
            ) : (
              <div className="mt-2 text-sm">
                <Badge tone="amber">待確認</Badge>
                <span className="ml-2 text-xs text-zinc-400">請回「待確認」標籤填寫確認緣由</span>
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">確認只代表中心端已確認，不下發車控，也不代表設備已恢復。</p>
          </section>
          <dl>
            <DetailRow label="中心端 ID">{event.id}</DetailRow>
            <DetailRow label="來源事件 ID">{event.eventId}</DetailRow>
            <DetailRow label="發生時間">
              {t(event.occurredAt)}
              {event.occurredAtValid === false ? <span className="ml-2 text-xs text-amber-300">來源未提供時間，以接收時間代替</span> : event.occurredAtValid === null ? <span className="ml-2 text-xs text-zinc-500">（舊資料，無法判斷是否為來源時間）</span> : null}
            </DetailRow>
            <DetailRow label="接收時間">{t(event.receivedAt)}</DetailRow>
            <DetailRow label="來源">
              {SOURCE_LABEL[event.sourceType]}：{event.sourceName ?? event.sourceId ?? '—'}
              {event.origin === 'CENTER' ? <span className="ml-2 text-xs text-zinc-400">（中心端依健康資料衍生，非車端事件回報）</span> : null}
            </DetailRow>
            <DetailRow label="載具 ID">{event.vehicleCode ?? <span className="text-zinc-500">不適用</span>}</DetailRow>
            <DetailRow label="事件類型">{event.eventLabel}（{event.eventCode}）</DetailRow>
            <DetailRow label="嚴重度">{SEVERITY_LABEL[event.severity] ?? event.severity}</DetailRow>
            <DetailRow label="摘要">{event.summary || '—'}</DetailRow>
            <DetailRow label="事件內容">{event.detail || '—'}</DetailRow>
            <DetailRow label="位置"><JsonBlock value={event.location} /></DetailRow>
            <DetailRow label="原始內容"><JsonBlock value={event.params} /></DetailRow>
            <DetailRow label="設備恢復">未知（沒有來源回報設備恢復的介接資料）</DetailRow>
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-medium">操作軌跡</h3>
            {event.trail.length ? (
              <ul className="space-y-1 text-sm">
                {event.trail.map((item) => (
                  <li key={item.id} className="text-zinc-300">
                    {t(item.at)}・{item.operatorName ?? '未知使用者'}・{item.action === 'EVENT_ACKNOWLEDGE' ? '人工確認' : item.action}・{item.result}
                    {item.note ? `・確認緣由：${item.note}` : ''}
                    {item.sourceIp ? <span className="text-zinc-500">（{item.sourceIp}）</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">尚無操作</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
