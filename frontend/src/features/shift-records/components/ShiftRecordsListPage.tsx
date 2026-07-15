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
import { BackToHomeButton } from '../../../components/BackToHomeButton';
import { StatusTag } from '../../../components/StatusTag';
import { VTMS_VEHICLE_POOL } from '../../dashboard/constants/vtmsVehiclePool';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import {
  exportShiftRecordsCsv,
  fetchShiftRecordList,
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
  type ExecutionStatusKey,
  type ShiftRecordListItem,
  type ShiftTab,
} from '../types';

type ShiftRecordsListPageProps = {
  onBackToHome?: () => void;
  onOpenDetail: (orderId: string) => void;
};

const PAGE_SIZE = 20;

export function ShiftRecordsListPage({ onBackToHome, onOpenDetail }: ShiftRecordsListPageProps) {
  const [tab, setTab] = useState<ShiftTab>('mainline');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatusKey | 'all'>('all');
  const [vehicleCode, setVehicleCode] = useState('');
  const [dateRange, setDateRange] = useState<DateTimeRange>({ start: null, end: null });
  const [appliedDateRange, setAppliedDateRange] = useState<DateTimeRange>({ start: null, end: null });
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ShiftRecordListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchShiftRecordList({
        tab,
        keyword,
        execution_status: executionStatus,
        vehicle_code: vehicleCode || undefined,
        planned_start_from: dateToPlannedStartMs(appliedDateRange.start),
        planned_start_to: dateToPlannedStartMs(appliedDateRange.end),
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [tab, keyword, executionStatus, vehicleCode, appliedDateRange, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.some((t) => t === 'table:operation_orders' || t.includes('operation'))) {
        void load();
      }
    });
  }, [load]);

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
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((r) => r.order_id)));
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
      exportShiftRecordsCsv(res.items, `shift-records-${tabLabel}.csv`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-4">
        <div className="flex items-center gap-3">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <ClipboardList className="size-5 text-sky-400" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">班次運行紀錄</h1>
        </div>
      </header>

      <div className="border-b border-zinc-800/80 px-6">
        <div className="flex gap-8">
          {(['mainline', 'maintenance'] as const).map((key) => {
            const label = key === 'mainline' ? '正線班次' : '整備班次';
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
          title="重置篩選條件"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          重置篩選
        </button>
        <div className="relative min-w-[180px] flex-1 basis-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder="請輸入班次代號或是站點名稱"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSearch && applySearch()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-600 focus:outline-none"
          />
        </div>
        <select
          value={executionStatus}
          onChange={(e) => {
            setExecutionStatus(e.target.value as ExecutionStatusKey | 'all');
            setPage(1);
          }}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {EXECUTION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label === '全部狀態' ? '選擇執行狀態' : opt.label}
            </option>
          ))}
        </select>
        <select
          value={vehicleCode}
          onChange={(e) => {
            setVehicleCode(e.target.value);
            setPage(1);
          }}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="">選擇執行載具</option>
          {VTMS_VEHICLE_POOL.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
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
          title="搜尋"
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
          下載
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
              <th className="py-3 pr-4 font-medium">班次代號</th>
              <th className="py-3 pr-4 font-medium">執行狀態</th>
              <th className="py-3 pr-4 font-medium">執行路線</th>
              <th className="py-3 pr-4 font-medium">執行載具</th>
              <th className="py-3 pr-4 font-medium">發車時間</th>
              <th className="py-3 pr-4 font-medium">結束時間</th>
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                  載入中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-zinc-500">
                  尚無符合條件的班次紀錄
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
                      label={row.execution_status_label}
                      style={EXECUTION_TAG_STYLE[row.execution_status]}
                    />
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{row.route_label}</td>
                  <td className="py-3 pr-4 text-zinc-300">{row.vehicle_code}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.depart_time ?? '—'}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.end_time ?? ''}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.order_id)}
                      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title="行車能力監控"
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
