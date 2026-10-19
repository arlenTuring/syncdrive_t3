import { PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { Badge, DetailRow, JsonBlock } from '../event-log-shared/ui';
import { formatDateTime } from '../event-log-shared/time';
import { acknowledgeEvent, fetchEvent, type EventDetail } from './api';

const SOURCE_LABEL = { VEHICLE: '載具', FACILITY: '設施', SYSTEM: '系統' } as const;
const SEVERITY_LABEL: Record<string, string> = { INFO: '資訊', WARNING: '警告', CRITICAL: '嚴重' };

/**
 * 事件詳情與人工確認。確認只記錄「中心端已閱覽／確認」：不下發車控、不清除故障、不解除降級，也不代表設備恢復。
 * 送出中鎖住按鈕防重複提交；後端條件更新，兩人同時確認時後到者會看到已被誰確認。
 */
export function EventDetailDialog({ id, timeZone, onClose, onChanged, onReplay }: { id: string; timeZone: string; onClose: () => void; onChanged: () => void; onReplay: (id: string) => void }) {
  const auth = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchEvent(id, controller.signal)
      .then(setEvent)
      .catch((reason: Error) => !controller.signal.aborted && setLoadError(reason.message));
    return () => controller.abort();
  }, [id]);

  const acknowledge = async () => {
    if (!event || saving || !auth.require('events.events.manage')) return;
    setSaving(true);
    setError('');
    try {
      const result = await acknowledgeEvent(event.id, note.trim());
      setEvent(result);
      setInfo(result.alreadyAcknowledged ? `這筆事件已由 ${result.acknowledgedByName ?? '其他人'} 先確認，顯示的是最新狀態` : '已確認事件');
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const t = (ms: number | null | undefined) => formatDateTime(ms, timeZone);
  return (
    <Dialog
      title="事件詳情"
      width="max-w-3xl"
      onClose={saving ? undefined : onClose}
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
          <GhostButton onClick={onClose} disabled={saving}>關閉</GhostButton>
        </>
      }
    >
      {loadError ? (
        <ErrorLine text={`載入失敗：${loadError}`} />
      ) : !event ? (
        <p className="py-10 text-center text-zinc-500">載入中…</p>
      ) : (
        <div className="space-y-5">
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
            <DetailRow label="位置"><JsonBlock value={event.location} /></DetailRow>
            <DetailRow label="原始內容"><JsonBlock value={event.params} /></DetailRow>
            <DetailRow label="人工確認">
              {event.acknowledged ? (
                <span>
                  <Badge tone="sky">已確認</Badge>
                  <span className="ml-2">{event.acknowledgedByName ?? '—'}・{t(event.acknowledgedAt)}</span>
                  {event.acknowledgementNote ? <div className="mt-1 text-zinc-300">備註：{event.acknowledgementNote}</div> : null}
                </span>
              ) : (
                <Badge tone="amber">未確認</Badge>
              )}
            </DetailRow>
            <DetailRow label="設備恢復">未知（沒有來源回報設備恢復的介接資料）</DetailRow>
          </dl>

          {!event.acknowledged ? (
            <section className="rounded-xl bg-[#232730] p-4">
              <h3 className="text-sm font-medium">確認事件</h3>
              <p className="mt-1 text-xs text-zinc-400">確認只代表中心端已閱覽；不會對車輛下發任何指令、不清除故障、不解除降級，也不代表設備已恢復。</p>
              <textarea
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="備註（選填，最多 500 字）"
                aria-label="確認備註"
                className="mt-3 h-20 w-full rounded-lg bg-[#1b1d23] p-3 text-sm outline-none focus:ring-1 focus:ring-sky-500"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">{note.length}/500</span>
                <PrimaryButton disabled={saving} onClick={() => void acknowledge()}>{saving ? '確認中…' : '確認事件'}</PrimaryButton>
              </div>
            </section>
          ) : null}
          {info ? <p className="rounded-xl bg-sky-500/10 px-4 py-3 text-sm text-sky-200">{info}</p> : null}
          {error ? <ErrorLine text={error} /> : null}

          <section>
            <h3 className="mb-2 text-sm font-medium">操作軌跡</h3>
            {event.trail.length ? (
              <ul className="space-y-1 text-sm">
                {event.trail.map((item) => (
                  <li key={item.id} className="text-zinc-300">
                    {t(item.at)}・{item.operatorName ?? '未知使用者'}・{item.action === 'EVENT_ACKNOWLEDGE' ? '人工確認' : item.action}・{item.result}
                    {item.note ? `・備註：${item.note}` : ''}
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
