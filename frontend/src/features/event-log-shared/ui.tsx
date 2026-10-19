import { ArrowDown, ArrowUp, ArrowUpDown, Download, RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { SiteSelect } from '../../components/SiteSelect';
import { Pagination } from '../media-groups/widgets';
import { timeZoneLabel, type RangeDraft } from './time';

/** 事件／日誌頁共用的查詢列、表格與狀態元件（沿用媒體頁的深色樣式） */

export type Option = { value: string; label: string };

export function FilterField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'min-w-[22rem]' : 'min-w-[11rem]'}`}>
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

const control = 'h-10 rounded-xl bg-[#222831] px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-500';

export function SelectFilter({ label, value, options, onChange, allLabel = '全部' }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; allLabel?: string }) {
  return (
    <FilterField label={label}>
      <SiteSelect
        aria-label={label}
        value={value}
        options={[{ value: '', label: allLabel }, ...options]}
        onChange={(event) => onChange(event.target.value)}
        className={`${control} w-full`}
      />
    </FilterField>
  );
}

export function TextFilter({ label, value, onChange, onEnter, placeholder, maxLength = 64 }: { label: string; value: string; onChange: (v: string) => void; onEnter: () => void; placeholder?: string; maxLength?: number }) {
  return (
    <FilterField label={label}>
      <input
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && onEnter()}
        className={`${control} placeholder:text-zinc-500`}
      />
    </FilterField>
  );
}

export function RangeFilter({ value, onChange, timeZone, error }: { value: RangeDraft; onChange: (v: RangeDraft) => void; timeZone: string; error?: string | null }) {
  return (
    <FilterField label={`時間區間（${timeZoneLabel(timeZone)}；含結束那一秒）`} wide>
      <div className="flex items-center gap-2">
        <SiteDateTimeInput type="datetime-local" step={1} aria-label="開始時間" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={`${control} flex-1`} />
        <span className="text-zinc-500">至</span>
        <SiteDateTimeInput type="datetime-local" step={1} aria-label="結束時間" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={`${control} flex-1`} />
      </div>
      {error ? <span role="alert" className="text-xs text-red-400">{error}</span> : null}
    </FilterField>
  );
}

export function QueryActions({ onSearch, onReset, onExport, exporting, canExport }: { onSearch: () => void; onReset: () => void; onExport?: () => void; exporting?: boolean; canExport?: boolean }) {
  return (
    <div className="flex items-end gap-2">
      <button type="button" onClick={onSearch} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium hover:bg-blue-500">
        <Search className="size-4" />
        搜尋
      </button>
      <button type="button" onClick={onReset} className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-white/5">
        <RefreshCw className="size-4" />
        重置
      </button>
      {onExport ? (
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          title={canExport === false ? '權限不足' : undefined}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-50"
        >
          <Download className="size-4" />
          {exporting ? '匯出中…' : '匯出 CSV'}
        </button>
      ) : null}
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  sort,
  onSort,
  onDetail,
  state,
  highlight,
}: {
  columns: Column<T>[];
  rows: T[];
  sort?: { by: string; direction: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  onDetail: (row: T) => void;
  state: ReactNode;
  highlight?: (row: T) => boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-zinc-800">
      <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#16181d] text-zinc-400">
          <tr className="border-b border-zinc-800">
            {columns.map((column) => {
              const active = sort?.by === column.sortKey;
              const Icon = !active ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th key={column.key} className={`px-4 py-3 font-normal ${column.className ?? ''}`} aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {column.sortKey && onSort ? (
                    <button type="button" onClick={() => onSort(column.sortKey!)} className="inline-flex items-center gap-1.5 hover:text-zinc-100">
                      {column.header}
                      <Icon className={`size-3.5 ${active ? 'text-sky-400' : 'text-zinc-600'}`} />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            <th className="w-24 px-4 py-3 font-normal">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`border-b border-zinc-800/80 align-top ${highlight?.(row) ? 'bg-sky-500/5' : ''}`}>
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
              <td className="px-4 py-3">
                <button type="button" onClick={() => onDetail(row)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/5">
                  查看詳情
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state}
    </div>
  );
}

export function ListState({ loading, error, empty, emptyText, onRetry }: { loading: boolean; error: string; empty: boolean; emptyText: string; onRetry: () => void }) {
  if (error) {
    return (
      <div role="alert" className="py-14 text-center text-sm text-red-300">
        {error}
        <button type="button" onClick={onRetry} className="ml-3 text-sky-300 underline">重試</button>
      </div>
    );
  }
  if (loading && empty) return <div className="py-14 text-center text-sm text-zinc-500">載入中…</div>;
  if (empty) return <div className="py-14 text-center text-sm text-zinc-500">{emptyText}</div>;
  return null;
}

export function ListFooter({ page, total, pageSize, onPage, summary }: { page: number; total: number; pageSize: number; onPage: (page: number) => void; summary: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-zinc-500">
      <span>{summary}</span>
      {total > pageSize ? <Pagination page={page} total={total} pageSize={pageSize} onChange={onPage} /> : null}
    </div>
  );
}

const TONE: Record<string, string> = {
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  amber: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  sky: 'bg-sky-500/15 text-sky-200 border-sky-500/30',
  green: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  zinc: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50',
};

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${TONE[tone]}`}>{children}</span>;
}

/** 詳情的欄位列 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-zinc-800/80 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-100">{children}</dd>
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-zinc-500">—</span>;
  return <pre className="max-h-60 overflow-auto rounded-lg bg-black/40 p-3 text-xs whitespace-pre-wrap text-zinc-300">{JSON.stringify(value, null, 2)}</pre>;
}
