import { ArrowDown, ArrowUp, ArrowUpDown, Download, RefreshCw, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { SiteSelect } from '../../components/SiteSelect';
import { Badge as UiBadge, Button, TextInput, type BadgeTone } from '../../components/ui';
import { Pagination } from '../media-groups/widgets';
import { timeZoneLabel, type RangeDraft } from './time';

/** 事件／日誌頁共用的查詢列、表格與狀態元件（沿用媒體頁的深色樣式） */

export type Option = { value: string; label: string };

export function FilterField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'min-w-[22rem]' : 'min-w-[11rem]'}`}>
      <span className="text-body-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}

export function SelectFilter({ label, value, options, onChange, allLabel = '全部' }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; allLabel?: string }) {
  return (
    <FilterField label={label}>
      <SiteSelect
        aria-label={label}
        value={value}
        options={[{ value: '', label: allLabel }, ...options]}
        onChange={(event) => onChange(event.target.value)}
        size="md"
        className="w-full"
      />
    </FilterField>
  );
}

export function TextFilter({ label, value, onChange, onEnter, placeholder, maxLength = 64 }: { label: string; value: string; onChange: (v: string) => void; onEnter: () => void; placeholder?: string; maxLength?: number }) {
  return (
    <FilterField label={label}>
      <TextInput
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && onEnter()}
      />
    </FilterField>
  );
}

export function RangeFilter({ value, onChange, timeZone, error, compact = false }: { value: RangeDraft; onChange: (v: RangeDraft) => void; timeZone: string; error?: string | null; compact?: boolean }) {
  return (
    <fieldset className={`@container min-w-0 ${compact ? 'flex-[0_1_32rem] max-w-full' : 'flex-[1_1_36rem]'}`}>
      <legend className="mb-1.5 text-body-xs text-text-tertiary">時間區間（{timeZoneLabel(timeZone)}；含結束那一秒）</legend>
      <div className={`grid min-w-0 grid-cols-1 gap-2 ${compact ? '@[30rem]:grid-cols-[minmax(14rem,1fr)_auto_minmax(14rem,1fr)] @[30rem]:items-end' : '@[36rem]:grid-cols-[minmax(16rem,1fr)_auto_minmax(16rem,1fr)] @[36rem]:items-end'}`}>
        <label className="min-w-0">
          <span className="mb-1 block text-body-xs text-text-quaternary">開始</span>
          <SiteDateTimeInput type="datetime-local" step={1} aria-label="開始時間" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} size="md" className="w-full" />
        </label>
        <span className={`hidden h-10 items-center text-text-quaternary ${compact ? '@[30rem]:flex' : '@[36rem]:flex'}`}>至</span>
        <label className="min-w-0">
          <span className="mb-1 block text-body-xs text-text-quaternary">結束</span>
          <SiteDateTimeInput type="datetime-local" step={1} aria-label="結束時間" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} size="md" className="w-full" />
        </label>
      </div>
      {error ? <span role="alert" className="text-body-xs text-status-error-emphasis">{error}</span> : null}
    </fieldset>
  );
}

export function QueryActions({ onSearch, onReset, onExport, exporting, canExport, searchLabel = '搜尋' }: { onSearch: () => void; onReset: () => void; onExport?: () => void; exporting?: boolean; canExport?: boolean; searchLabel?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Button onPress={onSearch} leadingIcon={<Search />}>
        {searchLabel}
      </Button>
      <Button hierarchy="subordinate" variant="outlined" onPress={onReset} leadingIcon={<RefreshCw />}>
        重置
      </Button>
      {onExport ? (
        <Button
          hierarchy="subordinate"
          variant="outlined"
          onPress={onExport}
          disabled={exporting}
          title={canExport === false ? '權限不足' : undefined}
          leadingIcon={<Download />}
        >
          {exporting ? '匯出中…' : '匯出 CSV'}
        </Button>
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
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border-quaternary">
      <table className="t3-table w-full min-w-[56rem] table-fixed text-left text-body-s">
        <thead className="sticky top-0 z-10 bg-surface-primary text-text-tertiary">
          <tr className="border-b border-border-quaternary">
            {columns.map((column) => {
              const active = sort?.by === column.sortKey;
              const Icon = !active ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th key={column.key} className={`px-4 py-3 font-normal ${column.className ?? ''}`} aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {column.sortKey && onSort ? (
                    <Button
                      hierarchy="subordinate"
                      variant="text"
                      onPress={() => onSort(column.sortKey!)}
                      trailingIcon={<Icon className={active ? 'text-text-theme' : 'text-text-disabled'} />}
                    >
                      {column.header}
                    </Button>
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
            <tr key={row.id} className={`border-b border-border-quaternary align-top ${highlight?.(row) ? 'bg-surface-theme-light' : ''}`}>
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
              <td className="px-4 py-3">
                <Button hierarchy="subordinate" variant="outlined" onPress={() => onDetail(row)}>
                  查看詳情
                </Button>
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
      <div role="alert" className="py-14 text-center text-body-s text-status-error-emphasis">
        {error}
        <Button variant="text" className="ml-3" onPress={onRetry}>重試</Button>
      </div>
    );
  }
  if (loading && empty) return <div className="py-14 text-center text-body-s text-text-quaternary">載入中…</div>;
  if (empty) return <div className="py-14 text-center text-body-s text-text-quaternary">{emptyText}</div>;
  return null;
}

export function ListFooter({ page, total, pageSize, onPage, summary }: { page: number; total: number; pageSize: number; onPage: (page: number) => void; summary: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-body-xs text-text-quaternary">
      <span>{summary}</span>
      {total > pageSize ? <Pagination page={page} total={total} pageSize={pageSize} onChange={onPage} /> : null}
    </div>
  );
}

const TONE = { red: 'error', amber: 'warning', sky: 'theme', green: 'success', zinc: 'neutral' } as const satisfies Record<string, BadgeTone>;

/** 事件／日誌頁的標籤：用系統的 Badge，顏色名稱對照到狀態語意 */
export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <UiBadge tone={TONE[tone]}>{children}</UiBadge>;
}

/** 詳情的欄位列 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-border-quaternary py-2 text-body-s">
      <dt className="text-text-quaternary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-text-quaternary">—</span>;
  return <pre className="max-h-60 overflow-auto rounded-lg bg-black-30 p-3 text-body-xs whitespace-pre-wrap text-text-secondary">{JSON.stringify(value, null, 2)}</pre>;
}
