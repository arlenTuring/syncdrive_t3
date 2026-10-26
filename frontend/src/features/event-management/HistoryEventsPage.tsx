import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { getSeverityStyle } from '../dashboard/constants/severityTheme';
import { Toast } from '../media-groups/dialogs';
import { DataTable, FilterField, ListFooter, ListState, QueryActions, RangeFilter, SelectFilter, type Column } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, recentRange, timeZoneLabel, type RangeDraft } from '../event-log-shared/time';
import { exportEvents, fetchEventOptions, fetchEvents, type EventItem, type EventList, type EventOptions, type EventQuery } from './api';
import { EventDetailDialog } from './EventDetailDialog';
import { EventReplayDialog } from './EventReplayDialog';

const DAY = 86_400_000;
type Draft = { range: RangeDraft; eventRecordId: string; vehicleCode: string; eventCode: string };
type Applied = Omit<Draft, 'range'> & { from?: number; to?: number; sortBy: string; direction: 'asc' | 'desc' };

function filtersOf(draft: Draft): Omit<Draft, 'range'> {
  return { eventRecordId: draft.eventRecordId, vehicleCode: draft.vehicleCode, eventCode: draft.eventCode };
}

function emptyDraft(tz: string): Draft {
  return { range: recentRange(7 * DAY, tz), eventRecordId: '', vehicleCode: '', eventCode: '' };
}

/**
 * 事件管理模組 → 歷史事件檢視（唯讀查詢）。
 *
 * - 可用事件 ID 精確查詢，或以日期起訖、載具、事件類型查詢；按搜尋／Enter 才套用並回第 1 頁。
 * - 查詢有固定上界（snapshot）：翻頁與詳情期間新事件不插隊，結果不隨新事件跳動。
 * - 這頁只查不處置：沒有處理狀態欄、確認狀態篩選或確認按鈕；處理紀錄在唯讀詳情最上方與 CSV。
 */
export function HistoryEventsPage() {
  const auth = useAuth();
  const [options, setOptions] = useState<EventOptions | null>(null);
  const tz = options?.timeZone ?? 'Asia/Taipei';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('Asia/Taipei'));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined);
  const [data, setData] = useState<EventList | null>(null);
  const [settled, setSettled] = useState({ key: '', error: '' });
  const [retryAt, setRetryAt] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);

  // 只載入選項與網站時區；不得因此查詢事件清單。
  useEffect(() => {
    const controller = new AbortController();
    void fetchEventOptions(controller.signal)
      .then((next) => {
        setOptions(next);
        const initial = emptyDraft(next.timeZone);
        setDraft(initial);
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: 'options', error: reason.message }));
    return () => controller.abort();
  }, []);

  const query = useMemo<EventQuery | null>(() => {
    if (!applied) return null;
    return {
      from: applied.from,
      to: applied.to,
      eventRecordId: applied.eventRecordId || undefined,
      vehicleCode: applied.vehicleCode || undefined,
      eventCode: applied.eventCode || undefined,
      sortBy: applied.sortBy,
      direction: applied.direction,
    };
  }, [applied]);

  const requestSnapshot = page === 1 ? undefined : snapshot;
  const requestKey = query ? `${JSON.stringify(query)}|${page}|${requestSnapshot ?? ''}|${retryAt}` : '';
  const loading = Boolean(query) && settled.key !== requestKey;
  const error = settled.key === requestKey || settled.key === 'options' ? settled.error : '';

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    void fetchEvents({ ...query, page, snapshot: requestSnapshot }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        // 條件變更讓頁碼超出：退回最後一頁
        const last = Math.max(1, Math.ceil(next.total / next.pageSize));
        if (page > last) return setPage(last);
        setData(next);
        if (page === 1) setSnapshot(next.snapshot);
        setSettled({ key: requestKey, error: '' });
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: requestKey, error: reason.message }));
    return () => controller.abort();
  }, [query, page, requestSnapshot, requestKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const search = () => {
    const eventRecordId = draft.eventRecordId.trim();
    if (eventRecordId) {
      if (!/^[1-9]\d{0,18}$/.test(eventRecordId) || (eventRecordId.length === 19 && eventRecordId > '9223372036854775807')) {
        return setRangeError('事件 ID 須為有效的正整數');
      }
      setRangeError(null);
      setApplied({ ...filtersOf({ ...draft, eventRecordId }), from: undefined, to: undefined, sortBy: applied?.sortBy ?? 'occurred_at', direction: applied?.direction ?? 'desc' });
      setSnapshot(undefined);
      setPage(1);
      return;
    }
    const range = rangeToQuery(draft.range, tz);
    if ('error' in range) return setRangeError(range.error);
    setRangeError(null);
    setApplied({ ...filtersOf(draft), ...range, sortBy: applied?.sortBy ?? 'occurred_at', direction: applied?.direction ?? 'desc' });
    setSnapshot(undefined);
    setPage(1);
  };
  const reset = () => {
    const initial = emptyDraft(tz);
    setDraft(initial);
    setRangeError(null);
    setApplied(null);
    setData(null);
    setSettled({ key: '', error: '' });
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
    { key: 'id', header: '事件 ID', className: 'w-32 font-mono tabular-nums', render: (row) => <span className="select-all">{row.id}</span> },
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
  ];

  const filters = options;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}>
        <RangeFilter compact value={draft.range} onChange={(range) => setDraft({ ...draft, range })} timeZone={tz} error={!draft.eventRecordId.trim() ? rangeError : null} />
        <FilterField label="事件 ID">
          <input type="text" inputMode="numeric" aria-label="事件 ID" placeholder="輸入事件 ID" maxLength={19} value={draft.eventRecordId} onChange={(event) => { setDraft({ ...draft, eventRecordId: event.target.value }); setRangeError(null); }} className="h-10 w-44 rounded-xl bg-[#222831] px-3 font-mono text-sm text-zinc-100 outline-none placeholder:font-sans placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500" />
          {draft.eventRecordId.trim() && rangeError ? <span role="alert" className="text-xs text-red-400">{rangeError}</span> : null}
        </FilterField>
        <SelectFilter label="載具" value={draft.vehicleCode} onChange={(v) => setDraft({ ...draft, vehicleCode: v })}
          options={(filters?.vehicles ?? []).map((v) => ({ value: v.vehicleCode, label: `${v.vehicleCode}${v.displayName !== v.vehicleCode ? ` ${v.displayName}` : ''}${v.active ? '' : '（已移除）'}` }))} />
        <SelectFilter label="事件類型" value={draft.eventCode} onChange={(v) => setDraft({ ...draft, eventCode: v })} options={filters?.eventCodes ?? []} />
        <QueryActions searchLabel="查詢" onSearch={search} onReset={reset} onExport={() => void doExport()} exporting={exporting} canExport={auth.can('events.events.export')} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        <span>
          {data?.range ? <>查詢區間：{formatDateTime(data.range.from, tz)} 至 {formatDateTime(data.range.to - 1, tz)}（{timeZoneLabel(tz)}）</> : applied?.eventRecordId ? <>精確事件 ID：<span className="select-all font-mono">{applied.eventRecordId}</span></> : <>查詢區間：—（{timeZoneLabel(tz)}）</>}
        </span>
      </div>

      {!applied ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-2xl border border-zinc-800 text-sm text-zinc-500">請設定條件後按查詢</div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            sort={{ by: applied.sortBy, direction: applied.direction }}
            onSort={sortBy}
            onDetail={(row) => setDetailId(row.id)}
            state={<ListState loading={loading} error={error} empty={!data?.items.length} emptyText={applied.eventRecordId ? '找不到此事件 ID，或紀錄已依保存政策移除' : '這段期間沒有符合條件的事件'} onRetry={() => setRetryAt(Date.now())} />}
          />
          <ListFooter
            page={page}
            total={data?.total ?? 0}
            pageSize={data?.pageSize ?? options?.pageSize ?? 8}
            onPage={setPage}
            summary={data ? `共 ${data.total} 筆，每頁 ${data.pageSize} 筆；同時間依事件 ID 排序` : ''}
          />
        </>
      )}

      {detailId ? (
        <EventDetailDialog
          id={detailId}
          timeZone={tz}
          refreshSignal={0}
          onClose={() => setDetailId(null)}
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
