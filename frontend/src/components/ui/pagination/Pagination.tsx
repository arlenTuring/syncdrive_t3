import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';

/**
 * 分頁（design-specs/t3-pagination-engineering-spec.md；樣式在 pagination.css，逐字取自規格 §6）。
 *
 * 頁碼規則照規格 §4：7 頁以下全列；更多頁時保留首末頁，開頭列 1～5、結尾列最後 5 頁、中段列目前頁前後各 2 頁；
 * 只略過 1 頁就直接補上，略過更多頁顯示可按的跳頁鈕（±5 頁）。
 * 每頁筆數（onPageSizeChange）與快速跳頁（showQuickJump）是選用的 Options；沒給就是精簡版。
 */

type Entry = { kind: 'page'; page: number } | { kind: 'jump'; direction: 'back' | 'forward' };

export function paginationEntries(current: number, totalPages: number): Entry[] {
  const page = (n: number): Entry => ({ kind: 'page', page: n });
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => page(i + 1));
  let middle: number[];
  if (current <= 4) middle = [2, 3, 4, 5];
  else if (current >= totalPages - 3) middle = [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1];
  else middle = [current - 2, current - 1, current, current + 1, current + 2];
  const out: Entry[] = [page(1)];
  const first = middle[0]!;
  const last = middle[middle.length - 1]!;
  if (first - 1 === 2) out.push(page(2));
  else if (first - 1 > 2) out.push({ kind: 'jump', direction: 'back' });
  for (const n of middle) out.push(page(n));
  if (totalPages - last === 2) out.push(page(totalPages - 1));
  else if (totalPages - last > 2) out.push({ kind: 'jump', direction: 'forward' });
  out.push(page(totalPages));
  return out;
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  className,
  disabled = false,
  label = '分頁',
  pageSizes = [10, 20, 50, 100],
  onPageSizeChange,
  showQuickJump = false,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
  /** 每頁筆數選項（給了 onPageSizeChange 才顯示） */
  pageSizes?: readonly number[];
  /** 改每頁筆數：第二個參數是換算後的頁碼（保留原頁第一筆所在的新頁） */
  onPageSizeChange?: (pageSize: number, page: number) => void;
  /** 顯示「跳至 [ ] 頁」 */
  showQuickJump?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  const empty = total <= 0;
  const off = disabled || empty;
  const current = Math.min(Math.max(1, page), totalPages);
  const go = (next: number) => {
    const target = Math.min(Math.max(1, next), totalPages);
    if (target !== current) onChange(target);
  };
  const showOptions = Boolean(onPageSizeChange) || showQuickJump;

  return (
    <div className={cn('flex justify-center', className)}>
      <nav aria-label={label} className="t3-pagination">
        <div className="t3-pagination__pages">
          <button type="button" className="t3-page" data-arrow="prev" aria-label="上一頁" disabled={off || current <= 1} onClick={() => go(current - 1)}>
            <ChevronLeft aria-hidden />
          </button>
          {paginationEntries(current, totalPages).map((entry) =>
            entry.kind === 'page' ? (
              <button
                key={entry.page}
                type="button"
                className="t3-page"
                data-wide={entry.page >= 100 ? 'true' : undefined}
                aria-current={entry.page === current ? 'page' : undefined}
                aria-label={`第 ${entry.page} 頁`}
                disabled={off}
                onClick={() => go(entry.page)}
              >
                {entry.page}
              </button>
            ) : (
              <button
                key={entry.direction}
                type="button"
                className="t3-page-jump"
                aria-label={entry.direction === 'back' ? '往前 5 頁' : '往後 5 頁'}
                disabled={off}
                onClick={() => go(current + (entry.direction === 'back' ? -5 : 5))}
              >
                {/* 圖示各包一層：規格 CSS 用 .t3-page-jump__dots／__arrow 切換顯示，svg 本身另有 display:block */}
                <span className="t3-page-jump__dots" aria-hidden><MoreHorizontal /></span>
                <span className="t3-page-jump__arrow" aria-hidden>
                  {entry.direction === 'back' ? <ChevronsLeft /> : <ChevronsRight />}
                </span>
              </button>
            ),
          )}
          <button type="button" className="t3-page" data-arrow="next" aria-label="下一頁" disabled={off || current >= totalPages} onClick={() => go(current + 1)}>
            <ChevronRight aria-hidden />
          </button>
        </div>
        {showOptions ? (
          <div className="t3-pagination__options">
            {onPageSizeChange ? (
              <PageSizeSelect
                value={pageSize}
                options={pageSizes}
                disabled={off}
                onChange={(size) => onPageSizeChange(size, Math.floor(((current - 1) * pageSize) / size) + 1)}
              />
            ) : null}
            {showQuickJump ? <QuickJump disabled={off} onJump={go} /> : null}
          </div>
        ) : null}
      </nav>
    </div>
  );
}

function PageSizeSelect({ value, options, disabled, onChange }: { value: number; options: readonly number[]; disabled: boolean; onChange: (size: number) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    items.current[Math.max(0, options.indexOf(value))]?.focus();
    return () => document.removeEventListener('mousedown', close);
  }, [open, options, value]);
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((item) => item === document.activeElement);
    const focus = (i: number) => items.current[(i + options.length) % options.length]?.focus();
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(options.length - 1);
    else if (event.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
    } else return;
    event.preventDefault();
  };
  return (
    <div ref={root} className="t3-pagination__size" onBlur={(event) => {
      if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        ref={trigger}
        type="button"
        className="t3-pagination__size-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value} 條/頁</span>
        <ChevronDown aria-hidden />
      </button>
      {open ? (
        <div id={menuId} role="listbox" className="t3-pagination__menu" onKeyDown={onMenuKey}>
          {options.map((size, index) => (
            <button
              key={size}
              ref={(node) => { items.current[index] = node; }}
              type="button"
              role="option"
              aria-selected={size === value}
              className="t3-pagination__size-option"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                if (size !== value) onChange(size);
              }}
            >
              {size} 條/頁
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuickJump({ disabled, onJump }: { disabled: boolean; onJump: (page: number) => void }) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const statusId = useId();
  return (
    <label className="t3-pagination__quick">
      <span>跳至</span>
      <input
        className="t3-pagination__input"
        inputMode="numeric"
        aria-label="跳至頁碼"
        aria-invalid={invalid || undefined}
        aria-describedby={statusId}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            setText('');
            setInvalid(false);
            return;
          }
          if (event.key !== 'Enter') return;
          const raw = text.trim();
          if (!raw) return;
          if (!/^-?\d+$/.test(raw)) {
            setInvalid(true);
            return;
          }
          onJump(Number(raw));
          setText('');
        }}
      />
      <span>頁</span>
      <span id={statusId} className="t3-pagination__status">{invalid ? '請輸入整數頁碼' : ''}</span>
    </label>
  );
}
