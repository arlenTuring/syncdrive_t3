import { Check } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { getSeverityStyle } from '../dashboard/constants/severityTheme';
import { Toast } from '../media-groups/dialogs';
import { formatDateTime } from '../event-log-shared/time';
import { acknowledgeEvent, fetchLiveEvents, type EventItem, type LiveBucket, type LiveEvents } from './api';
import { EventDetailDialog } from './EventDetailDialog';
import { EventReplayDialog } from './EventReplayDialog';

export const LIVE_STEP = 8;
const WINDOW_MAX = 500;
const REQUEST_MAX = 100;
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: '嚴重', WARNING: '警告', INFO: '資訊' };

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

type Props = {
  bucket: LiveBucket;
  active: boolean;
  refreshSignal: number;
  onTotals: (pending: number, confirmed: number) => void;
  onChanged: () => void;
};

/** 待確認／已確認集合。Socket 只由外層 EventManagementPage 訂閱。 */
export function LiveEventsPage({ bucket, active, refreshSignal, onTotals, onChanged }: Props) {
  const auth = useAuth();
  const [data, setData] = useState<LiveEvents | null>(null);
  const [items, setItems] = useState<EventItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const windowSize = useRef(LIVE_STEP);
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef<string | null>(null);
  const pendingAnchor = useRef<{ id: string; offset: number } | null>(null);
  const tz = data?.timeZone ?? 'Asia/Taipei';
  editingRef.current = editing;

  const load = useCallback(async () => {
    if (!active) return;
    const scroller = scrollRef.current;
    if (scroller && (scroller.scrollTop > 4 || editingRef.current)) {
      const top = scroller.getBoundingClientRect().top;
      const anchor = [...scroller.querySelectorAll<HTMLElement>('tr[data-event-id]')]
        .find((row) => row.getBoundingClientRect().bottom > top);
      const id = anchor?.dataset.eventId;
      if (anchor && id) pendingAnchor.current = { id, offset: anchor.getBoundingClientRect().top - top };
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const collected: EventItem[] = [];
      const ids = new Set<string>();
      let page: LiveEvents | null = null;
      let after: string | undefined;
      do {
        page = await fetchLiveEvents({ bucket, limit: Math.min(REQUEST_MAX, windowSize.current - collected.length), after });
        for (const item of page.items) {
          if (!ids.has(item.id)) collected.push(item);
          ids.add(item.id);
        }
        after = page.nextCursor ?? undefined;
      } while (page.hasMore && after && collected.length < windowSize.current);
      if (!mounted.current || seq !== requestSeq.current || !page) return;
      setItems(collected);
      setData(page);
      onTotals(page.pendingTotal, page.confirmedTotal);
      setError('');
    } catch (reason) {
      if (mounted.current && seq === requestSeq.current) setError((reason as Error).message);
    } finally {
      if (mounted.current && seq === requestSeq.current) setLoading(false);
    }
  }, [active, bucket, onTotals]);

  // 新事件插入或他人確認造成重查時，以中心端 ID 保住使用者正在看的列與草稿位置。
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    pendingAnchor.current = null;
    const row = [...scroller.querySelectorAll<HTMLElement>('tr[data-event-id]')]
      .find((candidate) => candidate.dataset.eventId === anchor.id);
    if (!row) return;
    const top = scroller.getBoundingClientRect().top;
    scroller.scrollTop += row.getBoundingClientRect().top - top - anchor.offset;
  }, [items]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestSeq.current += 1;
    };
  }, [load, refreshSignal]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const submitAck = async (id: string) => {
    if (busy[id] || !auth.require('events.events.manage')) return;
    const note = (drafts[id] ?? '').trim();
    if (!note) return setRowErrors((map) => ({ ...map, [id]: '請填寫確認緣由' }));
    if (note.length > 500) return setRowErrors((map) => ({ ...map, [id]: '確認緣由最多 500 字' }));
    setBusy((map) => ({ ...map, [id]: true }));
    setRowErrors((map) => without(map, id));
    try {
      const result = await acknowledgeEvent(id, note);
      if (!mounted.current) return;
      setItems((list) => list.filter((item) => item.id !== id));
      setEditing(null);
      setDrafts((map) => without(map, id));
      setNotice({ tone: 'success', id: Date.now(), text: result.alreadyAcknowledged ? `這筆事件已由 ${result.acknowledgedByName ?? '其他人'} 先確認` : '事件已確認' });
      onTotals(Math.max(0, (data?.pendingTotal ?? 1) - 1), (data?.confirmedTotal ?? 0) + (result.alreadyAcknowledged ? 0 : 1));
      onChanged();
    } catch (reason) {
      if (mounted.current) setRowErrors((map) => ({ ...map, [id]: `確認失敗：${(reason as Error).message}，可再試一次` }));
    } finally {
      if (mounted.current) setBusy((map) => without(map, id));
    }
  };

  const loadMore = () => {
    windowSize.current = Math.min(WINDOW_MAX, windowSize.current + LIVE_STEP);
    void load();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? <div className="flex items-center justify-between rounded-xl bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert"><span>更新失敗：{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-red-400/40 px-2.5 py-1">重試</button></div> : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded-2xl border border-zinc-800">
        <table className={`w-full table-fixed text-left text-sm ${bucket === 'confirmed' ? 'min-w-[82rem]' : 'min-w-[68rem]'}`}>
          <thead className="sticky top-0 z-10 bg-[#16181d] text-zinc-400">
            <tr className="border-b border-zinc-800">
              <th className="w-44 px-4 py-3 font-normal">發生時間</th><th className="w-36 px-4 py-3 font-normal">載具／來源</th><th className="w-40 px-4 py-3 font-normal">類型</th><th className="w-24 px-4 py-3 font-normal">嚴重度</th><th className="px-4 py-3 font-normal">事件摘要</th>
              {bucket === 'pending' ? <th className="w-60 px-4 py-3 font-normal">確認緣由／處置</th> : null}
              {bucket === 'confirmed' ? <><th className="w-52 px-4 py-3 font-normal">確認緣由</th><th className="w-32 px-4 py-3 font-normal">確認人</th><th className="w-44 px-4 py-3 font-normal">確認時間</th></> : null}
              <th className="w-24 px-4 py-3 font-normal">詳情</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const severity = getSeverityStyle(row.severity);
              return <tr key={row.id} data-event-id={row.id} className="border-b border-zinc-800/80 align-top">
                <td className="px-4 py-3 tabular-nums">{formatDateTime(row.occurredAt, tz)}</td>
                <td className="px-4 py-3"><div>{row.vehicleCode ?? row.sourceName ?? row.sourceId ?? '—'}</div>{row.vehicleCode && row.sourceName && row.sourceName !== row.vehicleCode ? <div className="text-xs text-zinc-500">{row.sourceName}</div> : null}</td>
                <td className="px-4 py-3">{row.eventLabel}</td>
                <td className="px-4 py-3"><span className="rounded-md px-2 py-0.5 text-xs" style={{ background: severity.stripBg, color: severity.stripText }}>{SEVERITY_LABEL[row.severity] ?? row.severity}</span></td>
                <td className="px-4 py-3"><div className="line-clamp-2 text-zinc-300" title={row.summary}>{row.summary || '—'}</div></td>
                {bucket === 'pending' ? <td className="px-4 py-3">{editing === row.id ? <form onSubmit={(event) => { event.preventDefault(); void submitAck(row.id); }} className="space-y-2">
                  <textarea autoFocus rows={2} value={drafts[row.id] ?? ''} maxLength={500} disabled={!!busy[row.id]} onChange={(event) => { setDrafts((map) => ({ ...map, [row.id]: event.target.value })); setRowErrors((map) => without(map, row.id)); }} placeholder="請填寫已確認的狀況或處理緣由" aria-label={`事件 ${row.eventId} 確認緣由`} className="w-full resize-none rounded-lg bg-[#1b1d23] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-sky-500" />
                  {rowErrors[row.id] ? <p className="text-xs text-red-300" role="alert">{rowErrors[row.id]}</p> : null}
                  <div className="flex gap-2"><button type="submit" disabled={!!busy[row.id]} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">{busy[row.id] ? '確認中…' : '確認事件'}</button><button type="button" disabled={!!busy[row.id]} onClick={() => setEditing(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs">取消</button></div>
                </form> : <button type="button" onClick={() => { if (auth.require('events.events.manage')) setEditing(row.id); }} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-xs text-white hover:bg-sky-500"><Check className="size-3.5" />填寫確認緣由</button>}</td> : null}
                {bucket === 'confirmed' ? <td className="px-4 py-3"><div className="line-clamp-2" title={row.acknowledgementNote ?? ''}>{row.acknowledgementNote || '舊資料未記錄'}</div></td> : null}
                {bucket === 'confirmed' ? <td className="px-4 py-3">{row.acknowledgedByName || '舊資料未記錄'}</td> : null}
                {bucket === 'confirmed' ? <td className="px-4 py-3 tabular-nums">{row.acknowledgedAt ? formatDateTime(row.acknowledgedAt, tz) : '舊資料未記錄'}</td> : null}
                <td className="px-4 py-3"><button type="button" onClick={() => setDetailId(row.id)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs hover:bg-white/5">查看詳情</button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {loading && !items.length ? <div className="py-14 text-center text-sm text-zinc-500">載入中…</div> : null}
        {!loading && !items.length && !error ? <div className="py-14 text-center text-sm text-zinc-500">{bucket === 'pending' ? '目前沒有待確認事件' : '目前沒有已確認事件'}</div> : null}
        {data?.hasMore && items.length < WINDOW_MAX ? <div className="py-3 text-center"><button type="button" onClick={loadMore} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs">載入更多（已顯示 {items.length}／共 {data.total} 筆）</button></div> : null}
      </div>
      {detailId ? <EventDetailDialog id={detailId} timeZone={tz} onClose={() => setDetailId(null)} refreshSignal={refreshSignal} onReplay={(id) => { setDetailId(null); setReplayId(id); }} /> : null}
      {replayId ? <EventReplayDialog id={replayId} onClose={() => setReplayId(null)} /> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}
