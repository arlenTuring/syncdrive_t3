import { BellRing } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { acquireSocket, releaseSocket } from '../dashboard/elements/socketManager';
import { DEFAULT_DATASOURCE } from '../dashboard/store/useDataSourceStore';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { getSeverityStyle } from '../dashboard/constants/severityTheme';
import { Toast } from '../media-groups/dialogs';
import { Badge, DataTable, ListFooter, ListState, QueryActions, RangeFilter, SelectFilter, type Column } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, recentRange, timeZoneLabel, type RangeDraft } from '../event-log-shared/time';
import { exportEvents, fetchEventOptions, fetchEvents, type EventItem, type EventList, type EventOptions, type EventQuery } from './api';
import { EventDetailDialog } from './EventDetailDialog';
import { EventReplayDialog } from './EventReplayDialog';

const DAY = 86_400_000;
type Mode = 'live' | 'history';
type Draft = { range: RangeDraft; vehicleCode: string; eventCode: string; severity: string; sourceType: string; acknowledged: string };
type Applied = Omit<Draft, 'range'> & { rolling: boolean; from: number; to: number; sortBy: string; direction: 'asc' | 'desc' };

function filtersOf(draft: Draft): Omit<Draft, 'range'> {
  return { vehicleCode: draft.vehicleCode, eventCode: draft.eventCode, severity: draft.severity, sourceType: draft.sourceType, acknowledged: draft.acknowledged };
}

function emptyDraft(mode: Mode, tz: string): Draft {
  return { range: recentRange(mode === 'live' ? DAY : 7 * DAY, tz), vehicleCode: '', eventCode: '', severity: '', sourceType: '', acknowledged: '' };
}

/**
 * 事件管理模組 → 事件資訊清單（mode=live）／歷史事件檢視（mode=history）。兩頁共用查詢、表格、詳情、匯出。
 *
 * - 即時清單預設最近 24 小時（每次查詢重新以「現在」為終點），每頁 8 筆，按發生時間＋ID 降冪。
 * - 查詢有固定上界（snapshot）：翻頁與詳情期間新事件不插隊；新事件以提示列告知，按一下才更新。
 * - 新事件推播只帶已持久化的中心端 ID，前端一律以 REST 重查；斷線重連也重查補齊。
 */
export function EventListPage({ mode }: { mode: Mode }) {
  const auth = useAuth();
  const [options, setOptions] = useState<EventOptions | null>(null);
  const tz = options?.timeZone ?? 'Asia/Taipei';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(mode, 'Asia/Taipei'));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined);
  const [data, setData] = useState<EventList | null>(null);
  const [settled, setSettled] = useState({ key: '', error: '' });
  const [reloadAt, setReloadAt] = useState(() => Date.now());
  const [pending, setPending] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const seen = useRef(new Set<string>());

  // 選項（含網站時區）載入後才建立預設條件，避免用瀏覽器時區
  useEffect(() => {
    const controller = new AbortController();
    void fetchEventOptions(controller.signal)
      .then((next) => {
        setOptions(next);
        const initial = emptyDraft(mode, next.timeZone);
        setDraft(initial);
        const range = rangeToQuery(initial.range, next.timeZone);
        if (!('error' in range)) {
          setApplied({ ...filtersOf(initial), rolling: mode === 'live', ...range, sortBy: 'occurred_at', direction: 'desc' });
        }
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: 'options', error: reason.message }));
    return () => controller.abort();
  }, [mode]);

  const query = useMemo<EventQuery | null>(() => {
    if (!applied) return null;
    // 即時清單的預設區間每次重新整理都以「現在」為終點（實際區間顯示在畫面上）
    const span = applied.rolling ? { from: reloadAt - DAY, to: reloadAt + 1_000 } : { from: applied.from, to: applied.to };
    return {
      ...span,
      vehicleCode: applied.vehicleCode || undefined,
      eventCode: applied.eventCode || undefined,
      severity: applied.severity || undefined,
      sourceType: applied.sourceType || undefined,
      acknowledged: applied.acknowledged || undefined,
      sortBy: applied.sortBy,
      direction: applied.direction,
    };
  }, [applied, reloadAt]);

  const requestKey = query ? `${JSON.stringify(query)}|${page}|${snapshot ?? ''}` : '';
  const loading = settled.key !== requestKey;
  const error = settled.key === requestKey || settled.key === 'options' ? settled.error : '';

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    void fetchEvents({ ...query, page, snapshot }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        // 刪除或條件變更讓頁碼超出：退回最後一頁
        const last = Math.max(1, Math.ceil(next.total / next.pageSize));
        if (page > last) return setPage(last);
        next.items.forEach((item) => seen.current.add(item.id));
        setData(next);
        if (!snapshot) setSnapshot(next.snapshot);
        setSettled({ key: requestKey, error: '' });
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: requestKey, error: reason.message }));
    return () => controller.abort();
  }, [query, page, snapshot, requestKey]);

  /** 取最新：清掉上界、回第 1 頁 */
  const refreshLatest = useCallback(() => {
    setPending(0);
    setSnapshot(undefined);
    setPage(1);
    setReloadAt(Date.now());
  }, []);

  // 新事件推播與斷線重連（只在即時清單）
  const idle = page === 1 && !detailId && !replayId && applied?.rolling && applied.sortBy === 'occurred_at' && applied.direction === 'desc';
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
  });
  useEffect(() => {
    if (mode !== 'live') return undefined;
    const url = DEFAULT_DATASOURCE.backendUrl;
    const socket = acquireSocket(url);
    const onEvent = (payload: { id?: string }) => {
      const id = payload?.id ? String(payload.id) : null;
      if (!id || seen.current.has(id)) return; // 沒有持久化 ID 或同一筆重送：不提示、不累加
      seen.current.add(id);
      if (idleRef.current) refreshLatest();
      else setPending((n) => n + 1);
    };
    const onReconnect = () => setReloadAt(Date.now());
    socket.on('security_event', onEvent);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('security_event', onEvent);
      socket.io.off('reconnect', onReconnect);
      releaseSocket(url);
    };
  }, [mode, refreshLatest]);

  // 其他人確認事件：同一上界重查（只更新狀態，不插入新列）
  useEffect(
    () =>
      subscribeDatasourceInvalidation((payload) => {
        if (payload.tags.includes('table:security_event_log')) setReloadAt(Date.now());
      }),
    [],
  );

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const search = () => {
    const range = rangeToQuery(draft.range, tz);
    if ('error' in range) return setRangeError(range.error);
    setRangeError(null);
    setApplied({ ...filtersOf(draft), rolling: false, ...range, sortBy: applied?.sortBy ?? 'occurred_at', direction: applied?.direction ?? 'desc' });
    setPending(0);
    setSnapshot(undefined);
    setPage(1);
  };
  const reset = () => {
    const initial = emptyDraft(mode, tz);
    setDraft(initial);
    setRangeError(null);
    const range = rangeToQuery(initial.range, tz);
    if ('error' in range) return;
    setApplied({ ...filtersOf(initial), rolling: mode === 'live', ...range, sortBy: 'occurred_at', direction: 'desc' });
    setPending(0);
    setSnapshot(undefined);
    setPage(1);
  };
  const sortBy = (key: string) => {
    if (!applied) return;
    setApplied({ ...applied, sortBy: key, direction: applied.sortBy === key && applied.direction === 'desc' ? 'asc' : 'desc' });
    setPage(1);
  };
  const doExport = async () => {
    if (!query || exporting || !auth.require('events.events.export')) return;
    setExporting(true);
    try {
      const result = await exportEvents(query);
      setNotice({
        tone: 'success',
        id: Date.now(),
        text: result.total > result.exported
          ? `符合 ${result.total} 筆，超過上限，只匯出依目前排序的前 ${result.exported} 筆`
          : `已匯出 ${result.exported} 筆`,
      });
    } catch (reason) {
      setNotice({ tone: 'error', id: Date.now(), text: `匯出失敗：${(reason as Error).message}` });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<EventItem>[] = [
    {
      key: 'time',
      header: '發生時間',
      sortKey: 'occurred_at',
      className: 'w-44',
      render: (row) => (
        <div>
          <div className="tabular-nums">{formatDateTime(row.occurredAt, tz)}</div>
          {row.occurredAtValid === false ? <div className="text-xs text-amber-300">來源未提供時間，以接收時間代替</div> : null}
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: '載具 ID',
      sortKey: 'vehicle_code',
      className: 'w-36',
      render: (row) =>
        row.vehicleCode ? (
          <div>
            <div>{row.vehicleCode}</div>
            {row.sourceName && row.sourceName !== row.vehicleCode ? <div className="text-xs text-zinc-500">{row.sourceName}</div> : null}
          </div>
        ) : (
          <div>
            <div className="text-zinc-500">不適用</div>
            <div className="text-xs text-zinc-400">{row.sourceName ?? row.sourceId}</div>
          </div>
        ),
    },
    {
      key: 'type',
      header: '事件類型',
      sortKey: 'event_code',
      className: 'w-40',
      render: (row) => (
        <div>
          <div>{row.eventLabel}</div>
          <div className="text-xs text-zinc-500">{row.eventCode}{row.origin === 'CENTER' ? '（中心端衍生）' : ''}</div>
        </div>
      ),
    },
    {
      key: 'severity',
      header: '嚴重度',
      sortKey: 'severity',
      className: 'w-24',
      render: (row) => {
        const style = getSeverityStyle(row.severity);
        return <span className="inline-flex rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: style.stripBg, color: style.stripText }}>{options?.severities.find((s) => s.value === row.severity)?.label ?? row.severity}</span>;
      },
    },
    { key: 'summary', header: '摘要', render: (row) => <div className="line-clamp-2 text-zinc-300" title={row.summary}>{row.summary || '—'}</div> },
    {
      key: 'status',
      header: '目前狀態',
      className: 'w-40',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          {row.acknowledged ? <Badge tone="sky">已確認</Badge> : <Badge tone="amber">未確認</Badge>}
          <span className="text-xs text-zinc-500">設備恢復：未知</span>
        </div>
      ),
    },
  ];

  const filters = options;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3">
        <RangeFilter value={draft.range} onChange={(range) => setDraft({ ...draft, range })} timeZone={tz} error={rangeError} />
        <SelectFilter label="載具" value={draft.vehicleCode} onChange={(v) => setDraft({ ...draft, vehicleCode: v })}
          options={(filters?.vehicles ?? []).map((v) => ({ value: v.vehicleCode, label: `${v.vehicleCode}${v.displayName !== v.vehicleCode ? ` ${v.displayName}` : ''}${v.active ? '' : '（已移除）'}` }))} />
        <SelectFilter label="事件類型" value={draft.eventCode} onChange={(v) => setDraft({ ...draft, eventCode: v })} options={filters?.eventCodes ?? []} />
        <SelectFilter label="目前狀態" value={draft.acknowledged} onChange={(v) => setDraft({ ...draft, acknowledged: v })} options={[{ value: 'false', label: '未確認' }, { value: 'true', label: '已確認' }]} />
        <SelectFilter label="嚴重度" value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v })} options={filters?.severities ?? []} />
        <SelectFilter label="來源" value={draft.sourceType} onChange={(v) => setDraft({ ...draft, sourceType: v })} options={filters?.sourceTypes ?? []} />
        <QueryActions onSearch={search} onReset={reset} onExport={() => void doExport()} exporting={exporting} canExport={auth.can('events.events.export')} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        <span>
          查詢區間：{data ? `${formatDateTime(data.range.from, tz)} 至 ${formatDateTime(data.range.to - 1, tz)}` : '—'}（{timeZoneLabel(tz)}）
          {applied?.rolling ? '，即時清單預設最近 24 小時' : ''}
        </span>
        {pending > 0 ? (
          <button type="button" onClick={refreshLatest} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600/20 px-3 py-1 text-sky-200 hover:bg-sky-600/30" aria-live="polite">
            <BellRing className="size-3.5" />
            有 {pending} 筆新事件，點擊更新
          </button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        sort={applied ? { by: applied.sortBy, direction: applied.direction } : undefined}
        onSort={sortBy}
        onDetail={(row) => setDetailId(row.id)}
        state={<ListState loading={loading} error={error} empty={!data?.items.length} emptyText="這段期間沒有符合條件的事件" onRetry={() => setReloadAt(Date.now())} />}
      />
      <ListFooter
        page={page}
        total={data?.total ?? 0}
        pageSize={data?.pageSize ?? options?.pageSize ?? 8}
        onPage={setPage}
        summary={data ? `共 ${data.total} 筆，每頁 ${data.pageSize} 筆；同時間依中心端 ID 排序` : ''}
      />

      {detailId ? (
        <EventDetailDialog
          id={detailId}
          timeZone={tz}
          onClose={() => setDetailId(null)}
          onChanged={() => setReloadAt(Date.now())}
          onReplay={(id) => {
            setDetailId(null);
            setReplayId(id);
          }}
        />
      ) : null}
      {replayId ? <EventReplayDialog id={replayId} onClose={() => setReplayId(null)} /> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}
