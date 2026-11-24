import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';

/**
 * 分頁（design-specs/t3-pagination-engineering-spec.md；樣式在 pagination.css，逐字取自規格 §6）。
 *
 * 頁碼規則照規格 §4：7 頁以下全列；更多頁時保留首末頁，開頭列 1～5、結尾列最後 5 頁、中段列目前頁前後各 2 頁；
 * 只略過 1 頁就直接補上，略過更多頁顯示可按的跳頁鈕（±5 頁）。
 * 每頁筆數（onPageSizeChange）與快速跳頁（showQuickJump）是選用的 Options；沒給就是精簡版。
 */

/** 規格原稿圖示（t3-pagination-playground.html 的 PAGINATION_ICONS，路徑逐字；顏色用 currentColor） */
function PrevIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M14 17.6537L8.34625 11.9999L14 6.34619L15.0538 7.39994L10.4538 11.9999L15.0538 16.5999L14 17.6537Z" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12.9463 11.9999L8.34625 7.39994L9.4 6.34619L15.0538 11.9999L9.4 17.6537L8.34625 16.5999L12.9463 11.9999Z" fill="currentColor" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M7.26923 15.75C6.78798 15.75 6.37605 15.5786 6.03343 15.2358C5.69063 14.8932 5.51923 14.4812 5.51923 14C5.51923 13.5187 5.69063 13.1068 6.03343 12.7642C6.37605 12.4214 6.78798 12.25 7.26923 12.25C7.75048 12.25 8.1625 12.4214 8.50531 12.7642C8.84792 13.1068 9.01923 13.5187 9.01923 14C9.01923 14.4812 8.84792 14.8932 8.50531 15.2358C8.1625 15.5786 7.75048 15.75 7.26923 15.75ZM14 15.75C13.5188 15.75 13.1068 15.5786 12.7642 15.2358C12.4214 14.8932 12.25 14.4812 12.25 14C12.25 13.5187 12.4214 13.1068 12.7642 12.7642C13.1068 12.4214 13.5188 12.25 14 12.25C14.4813 12.25 14.8932 12.4214 15.2358 12.7642C15.5786 13.1068 15.75 13.5187 15.75 14C15.75 14.4812 15.5786 14.8932 15.2358 15.2358C14.8932 15.5786 14.4813 15.75 14 15.75ZM20.7308 15.75C20.2496 15.75 19.8375 15.5786 19.4947 15.2358C19.1521 14.8932 18.9808 14.4812 18.9808 14C18.9808 13.5187 19.1521 13.1068 19.4947 12.7642C19.8375 12.4214 20.2496 12.25 20.7308 12.25C21.2121 12.25 21.624 12.4214 21.9666 12.7642C22.3094 13.1068 22.4808 13.5187 22.4808 14C22.4808 14.4812 22.3094 14.8932 21.9666 15.2358C21.624 15.5786 21.2121 15.75 20.7308 15.75Z" fill="currentColor" />
    </svg>
  );
}

function JumpBackIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M12.9792 20.596L6.38318 14L12.9792 7.40393L14.2086 8.63331L8.86001 14L14.2086 19.3666L12.9792 20.596ZM20.3876 20.596L13.7915 14L20.3876 7.40393L21.6169 8.63331L16.2683 14L21.6169 19.3666L20.3876 20.596Z" fill="currentColor" />
    </svg>
  );
}

function JumpForwardIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M11.7318 14L6.38318 8.63331L7.61255 7.40393L14.2086 14L7.61255 20.596L6.38318 19.3666L11.7318 14ZM19.1401 14L13.7915 8.63331L15.0209 7.40393L21.6169 14L15.0209 20.596L13.7915 19.3666L19.1401 14Z" fill="currentColor" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M9.99997 12.5448L5.28851 7.83333L6.16664 6.9552L9.99997 10.7885L13.8333 6.9552L14.7114 7.83333L9.99997 12.5448Z" fill="currentColor" />
    </svg>
  );
}

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

  // 規格 §5：頁碼重繪後保留原操作位置的焦點；那個位置不見了就移到目前頁
  const pagesRef = useRef<HTMLDivElement>(null);
  const focusSlot = useRef<number | null>(null);
  const rememberFocus = () => {
    const buttons = [...(pagesRef.current?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    focusSlot.current = at >= 0 ? at : null;
  };
  useLayoutEffect(() => {
    const slot = focusSlot.current;
    focusSlot.current = null;
    if (slot == null || !pagesRef.current) return;
    if (pagesRef.current.contains(document.activeElement) && !(document.activeElement as HTMLButtonElement).disabled) return;
    const buttons = [...pagesRef.current.querySelectorAll('button')];
    const target = buttons[slot] && !buttons[slot]!.disabled ? buttons[slot] : pagesRef.current.querySelector<HTMLButtonElement>('[aria-current="page"]');
    target?.focus();
  }, [current]);

  return (
    <div className={cn('flex justify-center', className)}>
      <nav aria-label={label} className="t3-pagination">
        <div ref={pagesRef} className="t3-pagination__pages" onClickCapture={rememberFocus} onKeyDownCapture={rememberFocus}>
          <button type="button" className="t3-page" data-arrow="prev" aria-label="上一頁" disabled={off || current <= 1} onClick={() => go(current - 1)}>
            <PrevIcon />
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
                <span className="t3-page-jump__dots" aria-hidden><DotsIcon /></span>
                <span className="t3-page-jump__arrow" aria-hidden>
                  {entry.direction === 'back' ? <JumpBackIcon /> : <JumpForwardIcon />}
                </span>
              </button>
            ),
          )}
          <button type="button" className="t3-page" data-arrow="next" aria-label="下一頁" disabled={off || current >= totalPages} onClick={() => go(current + 1)}>
            <NextIcon />
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
        <DownIcon />
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
