import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { Toast } from '../media-groups/dialogs';
import { Badge, DataTable, ListFooter, ListState, QueryActions, RangeFilter, SelectFilter, TextFilter, type Column, type Option } from '../event-log-shared/ui';
import { formatDateTime, rangeToQuery, recentRange, timeZoneLabel, type RangeDraft } from '../event-log-shared/time';
import { exportLogs, fetchLogOptions, fetchLogs, type LogCategory, type LogItem, type LogList, type LogOptions, type LogQuery } from './api';
import { LogDetailDialog } from './LogDetailDialog';

const WEEK = 7 * 86_400_000;

type Draft = { range: RangeDraft; [key: string]: string | RangeDraft };

type FieldSpec = { key: string; label: string; kind: 'select' | 'text'; options?: (o: LogOptions) => Option[]; placeholder?: string };

const operatorOptions = (o: LogOptions): Option[] => [
  { value: 'system', label: '系統（自動）' },
  { value: 'external-api', label: '外部整合（API 金鑰）' },
  ...o.accounts.map((a) => ({ value: a.id, label: `${a.displayName}（${a.accountName}）${a.deleted ? '［已刪除］' : ''}` })),
];

/** 各類日誌的篩選條件（後端會拒絕不適用的條件，所以只送這裡列出的） */
const FIELDS: Record<LogCategory, FieldSpec[]> = {
  system: [
    { key: 'operator', label: '使用者', kind: 'select', options: operatorOptions },
    { key: 'actionType', label: '日誌類型', kind: 'select', options: (o) => o.systemActions },
    { key: 'result', label: '結果', kind: 'select', options: (o) => o.results },
    { key: 'keyword', label: '關鍵字', kind: 'text', placeholder: '操作者、目標名稱或 ID' },
  ],
  operations: [
    { key: 'actionType', label: '操作類型', kind: 'select', options: (o) => o.operationActions },
    { key: 'vehicleCode', label: '載具', kind: 'text', placeholder: '例如 PMS01（含已移除車輛）' },
    { key: 'operator', label: '操作者', kind: 'select', options: operatorOptions },
    { key: 'result', label: '結果', kind: 'select', options: (o) => o.results },
  ],
  permissions: [
    { key: 'account', label: '相關使用者', kind: 'select', options: (o) => o.accounts.map((a) => ({ value: a.id, label: `${a.displayName}（${a.accountName}）${a.deleted ? '［已刪除］' : ''}` })) },
    { key: 'role', label: '角色', kind: 'select', options: (o) => o.roles.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'changeType', label: '異動類型', kind: 'select', options: (o) => o.changeTypes },
    { key: 'targetType', label: '異動對象', kind: 'select', options: (o) => o.permissionTargets },
  ],
  authentication: [
    { key: 'account', label: '帳號', kind: 'text', placeholder: '帳號名稱（含已刪除）' },
    { key: 'eventType', label: '紀錄類型', kind: 'select', options: (o) => o.loginTypes },
    { key: 'ip', label: '來源 IP', kind: 'text' },
  ],
};

function emptyDraft(category: LogCategory, tz: string): Draft {
  const draft: Draft = { range: recentRange(WEEK, tz) };
  for (const field of FIELDS[category]) draft[field.key] = '';
  return draft;
}

/**
 * 日誌管理模組的四個子頁共用這一個頁面（各自的篩選、權限與 API）。日誌唯讀：沒有修改或刪除功能。
 * 預設最近 7 天、每頁 20 筆，按時間＋編號降冪；查詢條件按「搜尋」或 Enter 才套用，回到第 1 頁。
 */
export function LogPage({ category }: { category: LogCategory }) {
  const auth = useAuth();
  const [options, setOptions] = useState<LogOptions | null>(null);
  const tz = options?.timeZone ?? 'Asia/Taipei';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(category, 'Asia/Taipei'));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [applied, setApplied] = useState<LogQuery | null>(null);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [data, setData] = useState<LogList | null>(null);
  const [settled, setSettled] = useState({ key: '', error: '' });
  const [reloadTick, setReloadTick] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);

  const toQuery = (d: Draft, timeZone: string): { query: LogQuery } | { error: string } => {
    const range = rangeToQuery(d.range, timeZone);
    if ('error' in range) return { error: range.error };
    const query: LogQuery = { from: range.from, to: range.to };
    for (const field of FIELDS[category]) {
      const value = String(d[field.key] ?? '').trim();
      if (value) query[field.key] = value;
    }
    return { query };
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchLogOptions(controller.signal)
      .then((next) => {
        setOptions(next);
        const initial = emptyDraft(category, next.timeZone);
        setDraft(initial);
        const q = toQuery(initial, next.timeZone);
        if ('query' in q) setApplied(q.query);
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: 'options', error: reason.message }));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 分類切換時重建
  }, [category]);

  const query = useMemo(() => (applied ? { ...applied, page, direction } : null), [applied, page, direction]);
  const requestKey = query ? `${JSON.stringify(query)}|${reloadTick}` : '';
  const loading = settled.key !== requestKey;
  const error = settled.key === requestKey || settled.key === 'options' ? settled.error : '';

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    void fetchLogs(category, query, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        const last = Math.max(1, Math.ceil(next.total / next.pageSize));
        if (page > last) return setPage(last);
        setData(next);
        setSettled({ key: requestKey, error: '' });
      })
      .catch((reason: Error) => !controller.signal.aborted && setSettled({ key: requestKey, error: reason.message }));
    return () => controller.abort();
  }, [category, query, page, requestKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const search = () => {
    const q = toQuery(draft, tz);
    if ('error' in q) return setRangeError(q.error);
    setRangeError(null);
    setApplied(q.query);
    setPage(1);
  };
  const reset = () => {
    const initial = emptyDraft(category, tz);
    setDraft(initial);
    setRangeError(null);
    const q = toQuery(initial, tz);
    if ('query' in q) setApplied(q.query);
    setDirection('desc');
    setPage(1);
  };
  const doExport = async () => {
    if (!applied || exporting || !auth.require(`logs.${category}.export`)) return;
    setExporting(true);
    try {
      const result = await exportLogs(category, { ...applied, direction });
      setNotice({ tone: 'success', id: Date.now(), text: result.total > result.exported ? `符合 ${result.total} 筆，超過上限，只匯出依時間排序的前 ${result.exported} 筆` : `已匯出 ${result.exported} 筆` });
    } catch (reason) {
      setNotice({ tone: 'error', id: Date.now(), text: `匯出失敗：${(reason as Error).message}` });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<LogItem>[] = [
    { key: 'id', header: '日誌編號', className: 'w-32', render: (row) => <span className="font-mono text-xs text-zinc-400" title={row.id}>{row.id.slice(0, 8)}</span> },
    { key: 'time', header: '時間', sortKey: 'occurred_at', className: 'w-44', render: (row) => <span className="tabular-nums">{formatDateTime(row.occurredAt, tz)}</span> },
    { key: 'ip', header: '來源 IP', className: 'w-32', render: (row) => row.sourceIp ?? <span className="text-zinc-500">—</span> },
    { key: 'type', header: '日誌類型', className: 'w-36', render: (row) => row.typeLabel },
    {
      key: 'operator',
      header: category === 'authentication' ? '帳號' : '操作者',
      className: 'w-40',
      render: (row) => (
        <div>
          <div className="truncate">{row.operator.name ?? `未知（${row.operator.id ?? '—'}）`}</div>
          {row.operator.nameSource === 'current' ? <div className="text-xs text-zinc-500">目前名稱</div> : null}
        </div>
      ),
    },
    { key: 'content', header: '內容', render: (row) => <div className="line-clamp-2 text-zinc-300" title={row.content}>{row.content}</div> },
    { key: 'result', header: '結果', className: 'w-20', render: (row) => <Badge tone={row.result === 'SUCCESS' ? 'green' : row.result === 'REJECTED' ? 'amber' : 'red'}>{row.resultLabel}</Badge> },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5 text-zinc-100">
      <div className="flex flex-wrap items-end gap-3">
        <RangeFilter value={draft.range} onChange={(range) => setDraft({ ...draft, range })} timeZone={tz} error={rangeError} />
        {FIELDS[category].map((field) =>
          field.kind === 'select' ? (
            <SelectFilter key={field.key} label={field.label} value={String(draft[field.key] ?? '')} onChange={(v) => setDraft({ ...draft, [field.key]: v })} options={options && field.options ? field.options(options) : []} />
          ) : (
            <TextFilter key={field.key} label={field.label} value={String(draft[field.key] ?? '')} placeholder={field.placeholder} onChange={(v) => setDraft({ ...draft, [field.key]: v })} onEnter={search} />
          ),
        )}
        <QueryActions onSearch={search} onReset={reset} onExport={() => void doExport()} exporting={exporting} canExport={auth.can(`logs.${category}.export`)} />
      </div>
      <p className="text-xs text-zinc-400">
        查詢區間：{data ? `${formatDateTime(data.range.from, tz)} 至 ${formatDateTime(data.range.to - 1, tz)}` : '—'}（{timeZoneLabel(tz)}）；日誌唯讀，查詢不會產生新的日誌
      </p>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        sort={{ by: 'occurred_at', direction }}
        onSort={() => {
          setDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
          setPage(1);
        }}
        onDetail={(row) => setDetail(row.id)}
        state={<ListState loading={loading} error={error} empty={!data?.items.length} emptyText="這段期間沒有符合條件的紀錄" onRetry={() => setReloadTick((n) => n + 1)} />}
      />
      <ListFooter page={page} total={data?.total ?? 0} pageSize={data?.pageSize ?? 20} onPage={setPage} summary={data ? `共 ${data.total} 筆，每頁 ${data.pageSize} 筆` : ''} />
      {detail ? <LogDetailDialog category={category} id={detail} timeZone={tz} onClose={() => setDetail(null)} /> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}
