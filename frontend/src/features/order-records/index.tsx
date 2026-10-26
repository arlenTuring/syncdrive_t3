import { useEffect, useMemo, useState } from 'react';
import { Dialog, GhostButton } from '../media-groups/dialogs';
import { Badge, DataTable, DetailRow, ListFooter, ListState, QueryActions, RangeFilter, SelectFilter, TextFilter, type Column } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, recentRange, type RangeDraft } from '../event-log-shared/time';
import { fetchOrderRecordDetail, fetchOrderRecordOptions, fetchOrderRecords, type OrderCategory, type OrderRecord, type OrderRecordOptions, type OrderRecordPage } from './api';

const DAY = 86_400_000;
type Draft = { keyword: string; range: RangeDraft; vehicleCode: string; category: string };
type Applied = Omit<Draft, 'range'> & { from: number; to: number; sortBy: string; direction: 'asc' | 'desc' };
const emptyDraft = (tz: string): Draft => ({ keyword: '', range: recentRange(30 * DAY, tz), vehicleCode: '', category: '' });
const TONES: Record<OrderCategory, 'sky' | 'green' | 'red' | 'zinc' | 'amber'> = { running: 'sky', pending: 'green', fault: 'red', completed: 'zinc', cancelled: 'amber' };

function Detail({ id, timeZone, onClose }: { id: string; timeZone: string; onClose: () => void }) {
  const [row, setRow] = useState<OrderRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchOrderRecordDetail(id, controller.signal).then(setRow, (reason: Error) => !controller.signal.aborted && setError(reason.message));
    return () => controller.abort();
  }, [id]);
  return (
    <Dialog title={row?.order_id ?? '訂單詳情'} onClose={onClose} footer={<GhostButton onClick={onClose}>關閉</GhostButton>}>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {!row && !error ? <p className="text-sm text-zinc-500">載入中…</p> : null}
      {row ? <dl>
        <DetailRow label="訂單名稱">{row.display_name}</DetailRow>
        <DetailRow label="訂單狀態">{row.category}{row.status_hint ? `・${row.status_hint}` : ''}</DetailRow>
        <DetailRow label="載具">{row.vehicle_code}</DetailRow>
        <DetailRow label="路線">{row.route_name || '—'}</DetailRow>
        <DetailRow label="計畫開始">{formatDateTime(row.planned_start, timeZone)}</DetailRow>
        <DetailRow label="計畫結束">{formatDateTime(row.planned_end, timeZone)}</DetailRow>
        <DetailRow label="實際開始">{formatDateTime(row.actual_start, timeZone)}</DetailRow>
        <DetailRow label="實際結束">{formatDateTime(row.actual_end, timeZone)}</DetailRow>
        <DetailRow label="原因">{row.reason || '—'}</DetailRow>
        <DetailRow label="站序">{row.stations.length ? row.stations.map((station) => station.station_name).join(' → ') : '—'}</DetailRow>
      </dl> : null}
    </Dialog>
  );
}

export default function OrderRecordsPage() {
  const [options, setOptions] = useState<OrderRecordOptions | null>(null);
  const timeZone = options?.time_zone ?? 'Asia/Taipei';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('Asia/Taipei'));
  const [applied, setApplied] = useState<Applied | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<number | undefined>(undefined);
  const [data, setData] = useState<OrderRecordPage | null>(null);
  const [settled, setSettled] = useState({ key: '', error: '' });
  const [retry, setRetry] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOrderRecordOptions(controller.signal).then((next) => {
      setOptions(next);
      setDraft(emptyDraft(next.time_zone));
    }, (reason: Error) => !controller.signal.aborted && setSettled({ key: 'options', error: reason.message }));
    return () => controller.abort();
  }, []);

  const requestSnapshot = page === 1 ? undefined : snapshot;
  const requestKey = applied ? `${JSON.stringify(applied)}|${page}|${requestSnapshot ?? ''}|${retry}` : '';
  const loading = Boolean(applied) && settled.key !== requestKey;
  const error = settled.key === requestKey || settled.key === 'options' ? settled.error : '';
  useEffect(() => {
    if (!applied) return undefined;
    const controller = new AbortController();
    void fetchOrderRecords({
      keyword: applied.keyword.trim() || undefined,
      from: applied.from,
      to: applied.to,
      vehicle_code: applied.vehicleCode || undefined,
      category: applied.category || undefined,
      page,
      page_size: options?.page_size ?? 20,
      sort_by: applied.sortBy,
      direction: applied.direction,
      snapshot: requestSnapshot,
    }, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      const last = Math.max(1, Math.ceil(next.total / next.page_size));
      if (page > last) return setPage(last);
      setData(next);
      if (page === 1) setSnapshot(next.snapshot);
      setSettled({ key: requestKey, error: '' });
    }, (reason: Error) => !controller.signal.aborted && setSettled({ key: requestKey, error: reason.message }));
    return () => controller.abort();
  }, [applied, options?.page_size, page, requestKey, requestSnapshot]);

  const search = () => {
    const parsed = rangeToQuery(draft.range, timeZone);
    if ('error' in parsed) return setRangeError(parsed.error);
    if (parsed.to - parsed.from > 366 * DAY) return setRangeError('查詢區間不得超過 366 日');
    setRangeError(null);
    setData(null);
    setSnapshot(undefined);
    setPage(1);
    setApplied({ keyword: draft.keyword, vehicleCode: draft.vehicleCode, category: draft.category, ...parsed, sortBy: applied?.sortBy ?? 'planned_start', direction: applied?.direction ?? 'desc' });
  };
  const reset = () => {
    setDraft(emptyDraft(timeZone));
    setApplied(null);
    setData(null);
    setSnapshot(undefined);
    setPage(1);
    setRangeError(null);
    setSettled({ key: '', error: '' });
  };
  const sort = (sortBy: string) => {
    if (!applied) return;
    setApplied({ ...applied, sortBy, direction: applied.sortBy === sortBy && applied.direction === 'desc' ? 'asc' : 'desc' });
    setSnapshot(undefined);
    setPage(1);
  };
  const categoryLabel = useMemo(() => new Map(options?.categories.map((item) => [item.value, item.label]) ?? []), [options]);
  const columns: Column<OrderRecord & { id: string }>[] = [
    { key: 'id', header: '訂單編號', sortKey: 'order_id', className: 'w-44', render: (row) => <span className="break-all">{row.order_id}</span> },
    { key: 'name', header: '訂單名稱', render: (row) => <span className="line-clamp-2">{row.display_name}</span> },
    { key: 'vehicle', header: '載具名稱', sortKey: 'vehicle_code', className: 'w-32', render: (row) => row.vehicle_code },
    { key: 'status', header: '訂單狀態', className: 'w-28', render: (row) => <Badge tone={TONES[row.category]}>{categoryLabel.get(row.category) ?? row.category}</Badge> },
    { key: 'start', header: '開始時間', sortKey: 'planned_start', className: 'w-44 tabular-nums', render: (row) => formatDateTime(row.planned_start, timeZone) },
    { key: 'end', header: '結束時間', sortKey: 'planned_end', className: 'w-44 tabular-nums', render: (row) => formatDateTime(row.planned_end, timeZone) },
  ];
  const rows = (data?.items ?? []).map((row) => ({ ...row, id: row.order_id }));
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}>
        <TextFilter label="關鍵字" value={draft.keyword} onChange={(keyword) => setDraft({ ...draft, keyword })} onEnter={search} placeholder="訂單、路線或載具" />
        <RangeFilter value={draft.range} onChange={(range) => setDraft({ ...draft, range })} timeZone={timeZone} error={rangeError} />
        <SelectFilter label="載具" value={draft.vehicleCode} onChange={(vehicleCode) => setDraft({ ...draft, vehicleCode })} options={(options?.vehicles ?? []).map((vehicle) => ({ value: vehicle.vehicle_code, label: `${vehicle.display_name}${vehicle.display_name === vehicle.vehicle_code ? '' : `（${vehicle.vehicle_code}）`}${vehicle.active ? '' : '（已移除）'}` }))} />
        <SelectFilter label="訂單狀態" value={draft.category} onChange={(category) => setDraft({ ...draft, category })} options={options?.categories ?? []} />
        <QueryActions onSearch={search} onReset={reset} />
      </div>
      {!applied ? <div className="flex min-h-56 flex-1 items-center justify-center rounded-2xl border border-zinc-800 text-sm text-zinc-500">請設定條件後按搜尋</div> : <>
        <DataTable columns={columns} rows={rows} sort={{ by: applied.sortBy, direction: applied.direction }} onSort={sort} onDetail={(row) => setDetailId(row.order_id)} state={<ListState loading={loading} error={error} empty={!rows.length} emptyText="這段期間沒有符合條件的訂單" onRetry={() => setRetry(Date.now())} />} />
        <ListFooter page={page} total={data?.total ?? 0} pageSize={data?.page_size ?? options?.page_size ?? 20} onPage={setPage} summary={data ? `共 ${data.total} 筆；依計畫開始時間與訂單編號穩定排序` : ''} />
      </>}
      {detailId ? <Detail id={detailId} timeZone={timeZone} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}
