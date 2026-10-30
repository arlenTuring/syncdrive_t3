import { SiteSelect } from '../../../components/SiteSelect';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCoalescedQuery } from '../../../lib/useCoalescedQuery';
import { useTranslation } from 'react-i18next';
import { BackToHomeButton } from '../../../components/BackToHomeButton';
import { StatusTag } from '../../../components/StatusTag';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchRegistry, type VehicleRegistration } from '../../vehicle-registry/api';
import {
  exportShiftRecordsCsv,
  fetchShiftRecordList,
  resolveShiftRecordsBackendUrl,
  type ShiftRecordListQuery,
} from '../api/shiftRecordsApi';
import {
  DateTimeRangePicker,
  dateToPlannedStartMs,
  hasDateTimeRangeFilter,
  type DateTimeRange,
} from './DateTimeRangePicker';
import {
  EXECUTION_STATUS_OPTIONS,
  EXECUTION_TAG_STYLE,
  executionDisplayKey,
  type ExecutionStatusKey,
  type ShiftTab,
} from '../types';

type ShiftRecordsListPageProps = {
  onBackToHome?: () => void;
  onOpenDetail: (orderId: string) => void;
  /** 殼層已有外框標題時隱藏本頁頂欄 */
  embedded?: boolean;
};

const PAGE_SIZE = 20;

/**
 * 會改變班次清單內容的失效標籤。只認這幾個，不再用「名稱含 operation」一網打盡——
 * 那會讓不相干的操作紀錄通知也觸發重查。
 */
const SHIFT_LIST_TAGS = new Set(['table:operation_orders', 'domain:mainline_shifts', 'domain:maintenance_shifts']);

function DateTimeCell({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const [date, time] = value.split(' ');
  return <><span className="block">{date}</span><span className="block">{time}</span></>;
}

export function ShiftRecordsListPage({
  onBackToHome,
  onOpenDetail,
  embedded = false,
}: ShiftRecordsListPageProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ShiftTab>('mainline');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatusKey | 'all'>('all');
  const [vehicleCode, setVehicleCode] = useState('');
  const [dateRange, setDateRange] = useState<DateTimeRange>({ start: null, end: null });
  const [appliedDateRange, setAppliedDateRange] = useState<DateTimeRange>({ start: null, end: null });
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRegistration[]>([]);

  /**
   * 清單查詢走 useCoalescedQuery：分頁、篩選、失效通知共用同一套生命週期。
   *
   * 車隊在跑時，中心端每有訂單進度就發 table:operation_orders 失效通知，好幾台車交錯一秒
   * 可能好幾則。以前每則都直接重打一支、回應誰先到誰寫，快速切篩選時舊條件的回應還會
   * 蓋掉新條件。現在同條件同時最多一支、期間的通知合併成一次補查（至少隔 500ms、失敗退避），
   * 換條件中止舊請求、舊回應不寫回；背景更新保留目前的列，不閃 Loading。
   */
  const backendUrl = resolveShiftRecordsBackendUrl();
  const query = useMemo<ShiftRecordListQuery>(() => ({
    tab,
    keyword,
    execution_status: executionStatus,
    vehicle_code: vehicleCode || undefined,
    planned_start_from: dateToPlannedStartMs(appliedDateRange.start),
    planned_start_to: dateToPlannedStartMs(appliedDateRange.end),
    page,
    page_size: PAGE_SIZE,
  }), [tab, keyword, executionStatus, vehicleCode, appliedDateRange, page]);
  const queryKey = JSON.stringify([backendUrl, query]);
  const loadList = useCallback(
    (signal: AbortSignal) => fetchShiftRecordList(query, backendUrl, signal),
    [query, backendUrl],
  );
  const list = useCoalescedQuery({ enabled: true, queryKey, load: loadList });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const timeZone = list.data?.time_zone || 'Asia/Taipei';
  const loading = list.initialLoading;
  const error = actionError ?? (list.initialError || list.backgroundError || null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * 勾選跟著查詢條件走：換條件就清空；同條件背景更新只保留還在這頁的列
   * （以前每次背景重整都清空勾選，車隊在跑時勾不住）。
   */
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });
  const selected = useMemo(() => {
    if (selection.key !== queryKey) return new Set<string>();
    const onPage = new Set(items.map((row) => row.order_id));
    return new Set([...selection.ids].filter((id) => onPage.has(id)));
  }, [selection, queryKey, items]);
  const setSelected = (update: (prev: Set<string>) => Set<string>) => {
    setSelection({ key: queryKey, ids: update(selected) });
  };

  useEffect(() => {
    let cancelled = false;
    void fetchRegistry({ keyword: '', page: 1, pageSize: 100, sortBy: 'name', sortDirection: 'asc' })
      .then((response) => { if (!cancelled) setVehicles(response.items.filter((item) => item.vehicleCode)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const refreshList = list.backgroundRefresh;
  useEffect(() => {
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.some((tag) => SHIFT_LIST_TAGS.has(tag))) refreshList();
    });
  }, [refreshList]);

  const pageNumbers = useMemo(() => {
    const max = Math.min(5, totalPages);
    const start = Math.max(1, Math.min(page - 2, totalPages - max + 1));
    return Array.from({ length: max }, (_, i) => start + i);
  }, [page, totalPages]);

  const toggleRow = (orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(() => new Set());
    } else {
      setSelected(() => new Set(items.map((r) => r.order_id)));
    }
  };

  const canSearch = hasDateTimeRangeFilter(dateRange) || keywordDraft.trim().length > 0;

  const applySearch = () => {
    setPage(1);
    setKeyword(keywordDraft.trim());
    setAppliedDateRange(dateRange);
  };

  const resetFilters = () => {
    setKeywordDraft('');
    setKeyword('');
    setExecutionStatus('all');
    setVehicleCode('');
    setDateRange({ start: null, end: null });
    setAppliedDateRange({ start: null, end: null });
    setPage(1);
  };

  const handleDownload = async () => {
    setExporting(true);
    setActionError(null);
    try {
      const res = await fetchShiftRecordList({
        tab,
        keyword,
        execution_status: executionStatus,
        vehicle_code: vehicleCode || undefined,
        planned_start_from: dateToPlannedStartMs(appliedDateRange.start),
        planned_start_to: dateToPlannedStartMs(appliedDateRange.end),
        page: 1,
        page_size: 5000,
      });
      const tabLabel = tab === 'mainline' ? 'mainline' : 'maintenance';
      exportShiftRecordsCsv(res.items, `shift-records-${tabLabel}.csv`, res.time_zone || timeZone);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      {!embedded ? (
        <header className="border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-4">
          <div className="flex items-center gap-3">
            {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
            <ClipboardList className="size-5 text-sky-400" aria-hidden />
            <h1 className="text-lg font-semibold tracking-tight">{t('shiftRecords.title')}</h1>
          </div>
        </header>
      ) : null}

      <div className="border-b border-zinc-800/80 px-6">
        <div className="flex gap-8">
          {(['mainline', 'maintenance'] as const).map((key) => {
            const label =
              key === 'mainline' ? t('shiftRecords.tabMainline') : t('shiftRecords.tabMaintenance');
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setPage(1);
                }}
                className={`border-b-2 py-3 text-sm font-medium transition ${
                  active
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-6 py-4">
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700"
          title={t('common.resetFiltersTitle')}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t('common.resetFilters')}
        </button>
        <div className="relative min-w-[180px] flex-1 basis-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder={t('shiftRecords.keywordPlaceholder')}
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSearch && applySearch()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-600 focus:outline-none"
          />
        </div>
        <SiteSelect
          value={executionStatus}
          onChange={(e) => {
            setExecutionStatus(e.target.value as ExecutionStatusKey | 'all');
            setPage(1);
          }}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {EXECUTION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === 'all'
                ? t('shiftRecords.selectExecutionStatus')
                : t(`shiftRecords.executionStatus.${opt.value}`)}
            </option>
          ))}
        </SiteSelect>
        <SiteSelect
          value={vehicleCode}
          onChange={(e) => {
            setVehicleCode(e.target.value);
            setPage(1);
          }}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="">{t('shiftRecords.selectVehicle')}</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.vehicleCode}>
              {vehicle.displayName === vehicle.vehicleCode
                ? vehicle.vehicleCode
                : `${vehicle.displayName}（${vehicle.vehicleCode}）`}
            </option>
          ))}
        </SiteSelect>
        <div className="shrink-0 min-w-[400px] max-w-[520px] flex-1 basis-[400px]">
          <DateTimeRangePicker value={dateRange} onChange={setDateRange} />
        </div>
        <button
          type="button"
          onClick={applySearch}
          disabled={!canSearch}
          className={`inline-flex size-9 items-center justify-center rounded-lg border transition ${
            canSearch
              ? 'border-sky-600 bg-sky-600/20 text-sky-300 hover:bg-sky-600/30'
              : 'cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-600'
          }`}
          title={t('common.search')}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={exporting}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t('common.download')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        {error && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="w-10 py-3 pr-2">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll}
                  className="rounded border-zinc-600 bg-zinc-900"
                />
              </th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.tripCode')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.executionStatus')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.route')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.vehicle')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.departTime')}</th>
              <th className="py-3 pr-4 font-medium">{t('shiftRecords.columns.endTime')}</th>
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  {t('common.loading')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  {t('shiftRecords.empty')}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.order_id}
                  className="border-b border-zinc-800/60 hover:bg-zinc-900/50"
                >
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.order_id)}
                      onChange={() => toggleRow(row.order_id)}
                      className="rounded border-zinc-600 bg-zinc-900"
                    />
                  </td>
                  <td className="py-3 pr-4 font-medium text-zinc-100">{row.trip_code}</td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`shiftRecords.executionStatus.${executionDisplayKey(row)}`)}
                      style={EXECUTION_TAG_STYLE[executionDisplayKey(row)]}
                    />
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{row.route_label}</td>
                  <td className="py-3 pr-4 text-zinc-300">{row.vehicle_code}</td>
                  <td className="py-3 pr-4 font-mono leading-5 text-zinc-400"><DateTimeCell value={row.depart_time} /></td>
                  <td className="py-3 pr-4 font-mono leading-5 text-zinc-400"><DateTimeCell value={row.end_time} /></td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.order_id)}
                      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title={t('shiftRecords.drivingCapability')}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-center gap-2 border-t border-zinc-800/80 px-6 py-4">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            className={`inline-flex size-8 items-center justify-center rounded-full text-sm ${
              n === page
                ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </footer>
    </div>
  );
}
