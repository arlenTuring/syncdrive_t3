import { ChevronDown, ChevronUp, ChevronsUpDown, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Toast } from '../media-groups/dialogs';
import { Pagination } from '../media-groups/widgets';
import { formatDateTime } from '../event-log-shared/time';
import { fetchEventOptions, fetchLiveEvents, type EventItem, type EventOptions, type LiveEvents, type LiveQuery, type LiveSort } from './api';
import { EventDetailDialog } from './EventDetailDialog';
import { EventReplayDialog } from './EventReplayDialog';
import { EventTypesDialog } from './EventTypesDialog';
import { ReportStatusBadge, SeverityBadge } from './eventBadges';
import { ReportFlow } from './ReportDialogs';
import { Button, IconButton, fieldClass } from '../../components/ui';

/** 第一次點欄位時的排序方向：時間新到舊、最嚴重在上、尚未回報在上 */
const FIRST_DIRECTION: Record<LiveSort, 'asc' | 'desc'> = { occurred_at: 'desc', severity: 'desc', status: 'asc' };
const DEFAULT_QUERY: LiveQuery = { page: 1, sortBy: 'occurred_at', direction: 'desc' };

const control = fieldClass({ size: 'md' });

type Props = { refreshSignal: number; onChanged: () => void };

/**
 * 即時事件清單（依設計稿）：尚未回報與已回報同一張表，預設發生時間新到舊，頁碼分頁。
 * 有新事件或別人回報時只重查目前這一頁，不跳頁、不清掉篩選。
 */
export function LiveEventsPage({ refreshSignal, onChanged }: Props) {
  const auth = useAuth();
  const [query, setQuery] = useState<LiveQuery>(DEFAULT_QUERY);
  const [keyword, setKeyword] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [options, setOptions] = useState<EventOptions | null>(null);
  const [data, setData] = useState<LiveEvents | null>(null);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<EventItem | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [typesVersion, setTypesVersion] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const requestSeq = useRef(0);
  const tz = data?.timeZone ?? options?.timeZone ?? 'Asia/Taipei';

  useEffect(() => {
    const controller = new AbortController();
    void fetchEventOptions(controller.signal).then(setOptions).catch(() => undefined);
    return () => controller.abort();
  }, [typesVersion]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const page = await fetchLiveEvents(query);
      if (seq !== requestSeq.current) return;
      const last = Math.max(1, Math.ceil(page.total / page.pageSize));
      if (query.page > last) {
        setQuery((value) => ({ ...value, page: last }));
        return;
      }
      setData(page);
      setError('');
    } catch (reason) {
      if (seq === requestSeq.current) setError((reason as Error).message);
    }
  }, [query]);

  useEffect(() => {
    // 只在請求回來後才 setState（非同步），不會連鎖重繪
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshSignal, typesVersion]);

  useEffect(() => () => { requestSeq.current += 1; }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const search = () => setQuery((value) => ({ ...value, page: 1, keyword: keyword.trim() || undefined, vehicleCode: vehicle || undefined, eventCode: eventCode || undefined }));
  const reset = () => {
    setKeyword('');
    setVehicle('');
    setEventCode('');
    setQuery(DEFAULT_QUERY);
  };
  const sortBy = (column: LiveSort) => setQuery((value) => ({
    ...value,
    page: 1,
    sortBy: column,
    direction: value.sortBy === column ? (value.direction === 'asc' ? 'desc' : 'asc') : FIRST_DIRECTION[column],
  }));

  const sortHeader = (column: LiveSort, label: string) => {
    const active = query.sortBy === column;
    const Icon = !active ? ChevronsUpDown : query.direction === 'asc' ? ChevronUp : ChevronDown;
    return (
      <Button hierarchy="subordinate" variant="text" className="w-full justify-between" aria-label={`依${label}排序`} onPress={() => sortBy(column)} trailingIcon={<Icon className={active ? 'text-text-primary' : 'text-text-quaternary'} />}>
        {label}
      </Button>
    );
  };
  const ariaSort = (column: LiveSort) => (query.sortBy === column ? (query.direction === 'asc' ? 'ascending' : 'descending') : 'none');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-[15rem]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" />
          <input value={keyword} maxLength={64} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="請輸入關鍵字" aria-label="關鍵字" className={`${control} w-full pl-9`} />
        </label>
        <SiteSelect aria-label="選擇載具" value={vehicle} placeholder="選擇載具" options={(options?.vehicles ?? []).map((item) => ({ value: item.vehicleCode, label: item.vehicleCode }))} onChange={(event) => setVehicle(event.target.value)} size="md" className="w-44" />
        <SiteSelect aria-label="選擇類型" value={eventCode} placeholder="選擇類型" options={options?.eventCodes ?? []} onChange={(event) => setEventCode(event.target.value)} size="md" className="w-44" />
        <IconButton label="搜尋" hierarchy="subordinate" variant="tonal" icon={<Search />} onPress={search} />
        <Button hierarchy="subordinate" variant="outlined" onPress={reset} leadingIcon={<RefreshCw />}>重置</Button>
        <Button variant="outlined" className="ml-auto" onPress={() => setTypesOpen(true)} leadingIcon={<SlidersHorizontal />}>事件類型管理</Button>
      </div>

      {error ? <div className="mt-4 flex items-center justify-between rounded-xl bg-status-error-light px-4 py-2 text-body-s text-status-error-emphasis" role="alert"><span>更新失敗：{error}</span><Button hierarchy="danger" variant="outlined" onPress={() => void load()}>重試</Button></div> : null}

      <div className="mt-4 min-h-0 flex-1 overflow-auto">
        <table className="t3-table w-full min-w-[64rem] table-fixed text-left text-body-s">
          <thead className="sticky top-0 z-10 bg-surface-primary text-text-tertiary">
            <tr className="border-b border-border-quaternary">
              <th className="w-48 px-4 py-3" aria-sort={ariaSort('occurred_at')}>{sortHeader('occurred_at', '發生時間')}</th>
              <th className="w-28 px-4 py-3 font-normal">事件編號</th>
              <th className="w-32 px-4 py-3 font-normal">載具名稱</th>
              <th className="px-4 py-3 font-normal">事件類型</th>
              <th className="w-40 px-4 py-3" aria-sort={ariaSort('severity')}>{sortHeader('severity', '嚴重度')}</th>
              <th className="w-40 px-4 py-3" aria-sort={ariaSort('status')}>{sortHeader('status', '回報狀態')}</th>
              <th className="w-48 px-4 py-3 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.id} data-event-id={row.id} className="border-b border-border-quaternary">
                <td className="px-4 py-4 whitespace-nowrap tabular-nums">{formatDateTime(row.occurredAt, tz)}</td>
                <td className="truncate px-4 py-4 tabular-nums" title={row.id}>{row.id}</td>
                <td className="truncate px-4 py-4" title={row.sourceName ?? undefined}>{row.vehicleCode ?? row.sourceName ?? row.sourceId ?? '—'}</td>
                <td className="truncate px-4 py-4" title={row.summary || row.eventLabel}>{row.eventLabel}</td>
                <td className="px-4 py-4"><SeverityBadge severity={row.severity} /></td>
                <td className="px-4 py-4"><ReportStatusBadge reported={row.acknowledged} /></td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <Button variant="text" onPress={() => setDetailId(row.id)}>查看詳情</Button>
                  {!row.acknowledged ? (
                    <>
                      <span className="mx-2 text-text-disabled" aria-hidden>|</span>
                      <Button variant="text" aria-label={`回報事件 ${row.id}`} onPress={() => { if (auth.require('events.events.manage')) setReporting(row); }}>回報</Button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error ? <div className="py-14 text-center text-text-quaternary">載入中…</div> : null}
        {data && !data.items.length && !error ? <div className="py-14 text-center text-text-quaternary">{query.keyword || query.vehicleCode || query.eventCode ? '沒有符合條件的事件' : '目前沒有事件'}</div> : null}
      </div>
      <Pagination page={query.page} total={data?.total ?? 0} pageSize={data?.pageSize ?? 10} onChange={(page) => setQuery((value) => ({ ...value, page }))} />

      {detailId ? <EventDetailDialog id={detailId} timeZone={tz} onClose={() => setDetailId(null)} refreshSignal={refreshSignal} onReplay={(id) => { setDetailId(null); setReplayId(id); }} /> : null}
      {replayId ? <EventReplayDialog id={replayId} onClose={() => setReplayId(null)} /> : null}
      {reporting ? (
        <ReportFlow
          event={reporting}
          timeZone={tz}
          onClose={() => setReporting(null)}
          onReported={(result) => {
            setReporting(null);
            setData((value) => value && { ...value, items: value.items.map((item) => (item.id === result.id ? { ...item, ...result } : item)) });
            setNotice({ tone: 'success', id: Date.now(), text: result.alreadyAcknowledged ? `這筆事件已由 ${result.acknowledgedByName ?? '其他人'} 先回報` : '事件已回報' });
            onChanged();
          }}
        />
      ) : null}
      {typesOpen ? (
        <EventTypesDialog
          onClose={() => setTypesOpen(false)}
          onSaved={() => {
            setTypesOpen(false);
            setTypesVersion((value) => value + 1);
            setNotice({ tone: 'success', id: Date.now(), text: '事件類型已儲存' });
          }}
        />
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}
