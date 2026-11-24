import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from '../../../lib/AnchoredPopover';
import { Button } from '../button/Button';
import { cn } from '../cn';
import type { FieldStyle } from '../variants';
import {
  PickerDateIcon,
  PickerNextIcon,
  PickerNextYearIcon,
  PickerPopupArrow,
  PickerPrevIcon,
  PickerPrevYearIcon,
  PickerTimeIcon,
} from './PickerIcons';

/**
 * 日期／時間選擇（design-specs/t3-date-time-picker-engineering-spec.md；樣式在 datepicker.css，逐字取自規格 §5）。
 *
 * 面板（DatePickerPanel 的 mode）：
 * - date、week（整週，週首為日）、month（3×4）、quarter（4 格）、year（十年＋首尾相鄰年）
 * - time（時分秒三欄，此刻／確定）、dateTime（日期＋時間，確定）
 * - dateRange、monthRange、yearRange（雙面板，端點 Active、中間 Middle）
 * 日期格「今天」照使用者裝置的本地日期，虛線圈＋aria-current="date"。
 * 時間欄捲軸照規格自繪：滑塊位置跟實際 scrollTop，滾輪、鍵盤、拖曳滑塊都捲同一個內容欄。
 */

export type PickerMode =
  | 'date' | 'week' | 'month' | 'quarter' | 'year'
  | 'time' | 'dateTime'
  | 'dateRange' | 'monthRange' | 'yearRange';

export type PickerRange = [Date | null, Date | null];

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date | null, b: Date | null) =>
  Boolean(a && b) && a!.getFullYear() === b!.getFullYear() && a!.getMonth() === b!.getMonth() && a!.getDate() === b!.getDate();
const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
const startOfWeek = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export function formatPickerValue(mode: PickerMode, value: Date | PickerRange | null, showSeconds = true): string {
  const one = (d: Date | null, m: PickerMode): string => {
    if (!d) return '';
    const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}${showSeconds ? `:${pad2(d.getSeconds())}` : ''}`;
    switch (m) {
      case 'week': {
        const s = startOfWeek(d);
        const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
        return `${one(s, 'date')} ~ ${one(e, 'date')}`;
      }
      case 'month': case 'monthRange': return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
      case 'year': case 'yearRange': return String(d.getFullYear());
      case 'time': return hms;
      case 'dateTime': return `${ymd} ${hms}`;
      default: return ymd;
    }
  };
  if (Array.isArray(value)) {
    const [a, b] = value;
    return a || b ? `${one(a, mode)} → ${one(b, mode)}` : '';
  }
  return one(value, mode);
}

/* ───────────── 時間欄（自繪捲軸） ───────────── */

export type TimePart = { value: number; max: number; step?: number; onChange: (n: number) => void; label: string };

function TimeColumn({ part, index }: { part: TimePart; index: number }) {
  const list = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const step = part.step ?? 1;
  const values = Array.from({ length: Math.floor(part.max / step) + 1 }, (_, i) => i * step);
  const sync = () => {
    const node = list.current;
    const bar = thumb.current;
    if (!node || !bar) return;
    const room = node.clientHeight - bar.offsetHeight;
    const ratio = node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight);
    bar.style.top = `${Math.max(0, room * ratio)}px`;
  };
  useLayoutEffect(() => {
    const node = list.current;
    const at = values.indexOf(part.value);
    const el = node?.children[at] as HTMLElement | undefined;
    if (node && el) node.scrollTop = el.offsetTop - node.clientHeight / 2 + el.offsetHeight / 2;
    sync();
    // 只在選值改變時置中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.value]);
  const drag = (event: React.PointerEvent<HTMLSpanElement>) => {
    const node = list.current;
    const bar = thumb.current;
    if (!node || !bar) return;
    event.preventDefault();
    const startY = event.clientY;
    const startTop = node.scrollTop;
    const room = node.clientHeight - bar.offsetHeight;
    const move = (e: PointerEvent) => {
      node.scrollTop = startTop + ((e.clientY - startY) / Math.max(1, room)) * (node.scrollHeight - node.clientHeight);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="time-column" data-part={index}>
      <div ref={list} className="time-list" role="listbox" aria-label={part.label} onScroll={sync}>
        {values.map((n) => (
          <button key={n} type="button" role="option" aria-selected={n === part.value} aria-pressed={n === part.value} onClick={() => part.onChange(n)}>
            {pad2(n)}
          </button>
        ))}
      </div>
      <span className="time-scroller" aria-hidden onPointerDown={drag}>
        <span ref={thumb} className="time-scrollbar" />
      </span>
    </div>
  );
}

export function PickerTimeColumns({ parts }: { parts: TimePart[] }) {
  return (
    <div className="time">
      {parts.map((part, index) => <TimeColumn key={part.label} part={part} index={index} />)}
    </div>
  );
}

/* ───────────── 導覽列 ───────────── */

function Nav({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" className="picker-nav" aria-label={label} title={label} onClick={onPress}>
      {children}
    </button>
  );
}

function Header({
  onPrevBig, onPrev, onNext, onNextBig, titles, bigLabel, smallLabel,
}: {
  onPrevBig: () => void; onPrev?: () => void; onNext?: () => void; onNextBig: () => void;
  titles: ReactNode[]; bigLabel: [string, string]; smallLabel?: [string, string];
}) {
  return (
    <header>
      <Nav label={bigLabel[0]} onPress={onPrevBig}><PickerPrevYearIcon className="picker-nav-icon" /></Nav>
      {onPrev ? <Nav label={smallLabel![0]} onPress={onPrev}><PickerPrevIcon className="picker-nav-icon" /></Nav> : null}
      <div className="picker-header-titles">
        {titles.map((title, i) => <div key={i} className="picker-header-title">{title}</div>)}
      </div>
      {onNext ? <Nav label={smallLabel![1]} onPress={onNext}><PickerNextIcon className="picker-nav-icon" /></Nav> : null}
      <Nav label={bigLabel[1]} onPress={onNextBig}><PickerNextYearIcon className="picker-nav-icon" /></Nav>
    </header>
  );
}

/* ───────────── 格子 ───────────── */

type Tone = 'active' | 'middle' | undefined;

function DayGrid({ year, month, toneOf, onPick }: { year: number; month: number; toneOf: (d: Date) => Tone; onPick: (d: Date) => void }) {
  const today = new Date();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return (
    <div className="grid days" role="grid">
      {WEEK_NAMES.map((w) => <span key={w} className="week-name" role="columnheader">{w}</span>)}
      {cells.map((d) => (
        <button
          key={dayKey(d)}
          type="button"
          className="cell"
          data-other={d.getMonth() !== month ? 'true' : undefined}
          data-today={sameDay(d, today) ? 'true' : undefined}
          data-tone={toneOf(d)}
          aria-current={sameDay(d, today) ? 'date' : undefined}
          aria-label={formatPickerValue('date', d)}
          onClick={() => onPick(d)}
        >
          <span>{d.getDate()}</span>
        </button>
      ))}
    </div>
  );
}

function UnitGrid({ items, quarter = false }: { items: Array<{ key: string; label: string; tone: Tone; other?: boolean; onPick: () => void }>; quarter?: boolean }) {
  return (
    <div className={cn('grid units', quarter && 'quarter')}>
      {items.map((item) => (
        <button key={item.key} type="button" className="cell unit" data-tone={item.tone} data-other={item.other ? 'true' : undefined} onClick={item.onPick}>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────── 面板 ───────────── */

export type DatePickerPanelProps = {
  mode: PickerMode;
  value: Date | PickerRange | null;
  /** 選定（date／week／month／quarter／year 點選即回；time／dateTime 按確定；區間選完兩端） */
  onChange: (value: Date | PickerRange) => void;
  /** time 模式的「此刻」；沒給就用裝置時間 */
  onNow?: () => Date;
  showSeconds?: boolean;
  /** 時間秒欄的步進（例如 10 秒對齊班表） */
  secondStep?: number;
  /** 彈出時顯示頂端箭頭 */
  arrow?: boolean;
  className?: string;
};

export function DatePickerPanel({ mode, value, onChange, onNow, showSeconds = true, secondStep = 1, arrow = false, className }: DatePickerPanelProps) {
  const isRange = mode === 'dateRange' || mode === 'monthRange' || mode === 'yearRange';
  const single = !isRange && !Array.isArray(value) ? (value as Date | null) : null;
  const range: PickerRange = isRange && Array.isArray(value) ? value : [null, null];
  const base = single ?? range[0] ?? new Date();
  const [viewYear, setViewYear] = useState(base.getFullYear());
  const [viewMonth, setViewMonth] = useState(base.getMonth());
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [draft, setDraft] = useState<Date>(single ?? new Date(new Date().setHours(0, 0, 0, 0)));
  const [pending, setPending] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);

  const shiftMonth = (n: number) => {
    const d = new Date(viewYear, viewMonth + n, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  // 區間：第一下定起點，第二下定終點（順序顛倒自動交換）
  const pickRange = (d: Date) => {
    if (!pending) {
      setPending(d);
      return;
    }
    const [a, b] = pending.getTime() <= d.getTime() ? [pending, d] : [d, pending];
    setPending(null);
    onChange([a, b]);
  };
  const rangeTone = (d: Date, unit: (x: Date) => number): Tone => {
    const [a, b] = pending ? [pending, hover ?? pending] : range;
    if (!a || !b) return a && unit(a) === unit(d) ? 'active' : undefined;
    const [lo, hi] = unit(a) <= unit(b) ? [unit(a), unit(b)] : [unit(b), unit(a)];
    const k = unit(d);
    if (k === lo || k === hi) return 'active';
    return k > lo && k < hi ? 'middle' : undefined;
  };
  const dayUnit = (d: Date) => dayKey(d);
  const monthUnit = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const yearUnit = (d: Date) => d.getFullYear();

  const monthTitle = (y: number, m: number) => (
    <>
      <button type="button" className="picker-heading-button" onClick={() => setView('years')}>{y}年</button>
      <button type="button" className="picker-heading-button" onClick={() => setView('months')}>{m + 1}月</button>
    </>
  );

  const timeParts = (d: Date, set: (next: Date) => void): TimePart[] => {
    const with_ = (h: number, mi: number, s: number) => {
      const n = new Date(d);
      n.setHours(h, mi, s, 0);
      set(n);
    };
    const parts: TimePart[] = [
      { label: '時', value: d.getHours(), max: 23, onChange: (h) => with_(h, d.getMinutes(), d.getSeconds()) },
      { label: '分', value: d.getMinutes(), max: 59, onChange: (mi) => with_(d.getHours(), mi, d.getSeconds()) },
    ];
    if (showSeconds) parts.push({ label: '秒', value: d.getSeconds() - (d.getSeconds() % secondStep), max: 60 - secondStep, step: secondStep, onChange: (s) => with_(d.getHours(), d.getMinutes(), s) });
    return parts;
  };

  let body: ReactNode = null;
  let footer: ReactNode = null;

  const dayToneSingle = (d: Date): Tone => {
    if (mode === 'week' && single) {
      const s = startOfWeek(single);
      const k = dayKey(d);
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
      if (k === dayKey(s) || k === dayKey(e)) return 'active';
      return k > dayKey(s) && k < dayKey(e) ? 'middle' : undefined;
    }
    const target = mode === 'dateTime' ? draft : single;
    return sameDay(d, target) ? 'active' : undefined;
  };

  const yearsGrid = (startYear: number, toneOf: (y: number) => Tone, onPick: (y: number) => void) =>
    <UnitGrid items={Array.from({ length: 12 }, (_, i) => startYear - 1 + i).map((y, i) => ({
      key: String(y), label: String(y), tone: toneOf(y), other: i === 0 || i === 11, onPick: () => onPick(y),
    }))} />;

  if (mode === 'date' || mode === 'week' || mode === 'dateTime') {
    if (view === 'months') {
      body = (
        <div className="calendar">
          <Header onPrevBig={() => setViewYear(viewYear - 1)} onNextBig={() => setViewYear(viewYear + 1)} titles={[<span key="y" className="picker-heading-button">{viewYear}年</span>]} bigLabel={['前一年', '後一年']} />
          <UnitGrid items={Array.from({ length: 12 }, (_, m) => ({ key: String(m), label: `${m + 1}月`, tone: viewMonth === m ? 'active' : undefined, onPick: () => { setViewMonth(m); setView('days'); } }))} />
        </div>
      );
    } else if (view === 'years') {
      const decade = Math.floor(viewYear / 10) * 10;
      body = (
        <div className="calendar">
          <Header onPrevBig={() => setViewYear(viewYear - 10)} onNextBig={() => setViewYear(viewYear + 10)} titles={[<span key="d" className="picker-heading-button">{decade}–{decade + 9}</span>]} bigLabel={['前十年', '後十年']} />
          {yearsGrid(decade, (y) => (y === viewYear ? 'active' : undefined), (y) => { setViewYear(y); setView('months'); })}
        </div>
      );
    } else {
      const calendar = (
        <div className="calendar">
          {mode === 'dateTime' ? null : (
            <Header onPrevBig={() => setViewYear(viewYear - 1)} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} onNextBig={() => setViewYear(viewYear + 1)} titles={[monthTitle(viewYear, viewMonth)]} bigLabel={['前一年', '後一年']} smallLabel={['前一月', '後一月']} />
          )}
          <DayGrid
            year={viewYear}
            month={viewMonth}
            toneOf={dayToneSingle}
            onPick={(d) => {
              if (d.getMonth() !== viewMonth) { setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
              if (mode === 'dateTime') {
                const n = new Date(draft);
                n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                setDraft(n);
              } else onChange(mode === 'week' ? startOfWeek(d) : d);
            }}
          />
        </div>
      );
      body = mode === 'dateTime' ? (
        <>
          <div className="picker-datetime-header">
            <Header onPrevBig={() => setViewYear(viewYear - 1)} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} onNextBig={() => setViewYear(viewYear + 1)} titles={[monthTitle(viewYear, viewMonth)]} bigLabel={['前一年', '後一年']} smallLabel={['前一月', '後一月']} />
            <div className="picker-time-heading" />
          </div>
          <div className="panes">
            {calendar}
            <PickerTimeColumns parts={timeParts(draft, setDraft)} />
          </div>
        </>
      ) : calendar;
    }
    footer = mode === 'dateTime' ? (
      <footer><Button onPress={() => onChange(draft)}>確定</Button></footer>
    ) : view === 'days' ? (
      <footer><Button variant="text" onPress={() => { const t = new Date(); onChange(mode === 'week' ? startOfWeek(t) : new Date(t.getFullYear(), t.getMonth(), t.getDate())); }}>今天</Button></footer>
    ) : null;
  } else if (mode === 'month' || mode === 'quarter') {
    body = (
      <div className="calendar">
        <Header onPrevBig={() => setViewYear(viewYear - 1)} onNextBig={() => setViewYear(viewYear + 1)} titles={[<span key="y" className="picker-heading-button">{viewYear}年</span>]} bigLabel={['前一年', '後一年']} />
        {mode === 'month' ? (
          <UnitGrid items={Array.from({ length: 12 }, (_, m) => ({
            key: String(m), label: `${m + 1}月`,
            tone: single && single.getFullYear() === viewYear && single.getMonth() === m ? 'active' : undefined,
            onPick: () => onChange(new Date(viewYear, m, 1)),
          }))} />
        ) : (
          <UnitGrid quarter items={[0, 1, 2, 3].map((q) => ({
            key: String(q), label: `Q${q + 1}`,
            tone: single && single.getFullYear() === viewYear && Math.floor(single.getMonth() / 3) === q ? 'active' : undefined,
            onPick: () => onChange(new Date(viewYear, q * 3, 1)),
          }))} />
        )}
      </div>
    );
  } else if (mode === 'year') {
    const decade = Math.floor(viewYear / 10) * 10;
    body = (
      <div className="calendar">
        <Header onPrevBig={() => setViewYear(viewYear - 10)} onNextBig={() => setViewYear(viewYear + 10)} titles={[<span key="d" className="picker-heading-button">{decade}–{decade + 9}</span>]} bigLabel={['前十年', '後十年']} />
        {yearsGrid(decade, (y) => (single?.getFullYear() === y ? 'active' : undefined), (y) => onChange(new Date(y, 0, 1)))}
      </div>
    );
  } else if (mode === 'time') {
    body = <PickerTimeColumns parts={timeParts(draft, setDraft)} />;
    footer = (
      <footer>
        <Button variant="text" onPress={() => setDraft(onNow ? onNow() : new Date())}>此刻</Button>
        <Button onPress={() => onChange(draft)}>確定</Button>
      </footer>
    );
  } else if (mode === 'dateRange') {
    const right = new Date(viewYear, viewMonth + 1, 1);
    body = (
      <>
        <Header onPrevBig={() => setViewYear(viewYear - 1)} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} onNextBig={() => setViewYear(viewYear + 1)}
          titles={[<span key="l" className="picker-heading-button">{viewYear}年 {viewMonth + 1}月</span>, <span key="r" className="picker-heading-button">{right.getFullYear()}年 {right.getMonth() + 1}月</span>]}
          bigLabel={['前一年', '後一年']} smallLabel={['前一月', '後一月']} />
        <div className="panes" onMouseLeave={() => setHover(null)}>
          {[[viewYear, viewMonth], [right.getFullYear(), right.getMonth()]].map(([y, m]) => (
            <div key={`${y}-${m}`} className="calendar" onMouseOver={(e) => {
              const label = (e.target as HTMLElement).closest('button')?.getAttribute('aria-label');
              if (label && pending) setHover(new Date(`${label}T00:00:00`));
            }}>
              <DayGrid year={y!} month={m!} toneOf={(d) => rangeTone(d, dayUnit)} onPick={pickRange} />
            </div>
          ))}
        </div>
      </>
    );
  } else if (mode === 'monthRange') {
    body = (
      <>
        <Header onPrevBig={() => setViewYear(viewYear - 1)} onNextBig={() => setViewYear(viewYear + 1)}
          titles={[<span key="l" className="picker-heading-button">{viewYear}年</span>, <span key="r" className="picker-heading-button">{viewYear + 1}年</span>]} bigLabel={['前一年', '後一年']} />
        <div className="panes">
          {[viewYear, viewYear + 1].map((y) => (
            <div key={y} className="calendar">
              <UnitGrid items={Array.from({ length: 12 }, (_, m) => ({ key: `${y}-${m}`, label: `${m + 1}月`, tone: rangeTone(new Date(y, m, 1), monthUnit), onPick: () => pickRange(new Date(y, m, 1)) }))} />
            </div>
          ))}
        </div>
      </>
    );
  } else if (mode === 'yearRange') {
    const decade = Math.floor(viewYear / 10) * 10;
    body = (
      <>
        <Header onPrevBig={() => setViewYear(viewYear - 10)} onNextBig={() => setViewYear(viewYear + 10)}
          titles={[<span key="l" className="picker-heading-button">{decade}–{decade + 9}</span>, <span key="r" className="picker-heading-button">{decade + 10}–{decade + 19}</span>]} bigLabel={['前十年', '後十年']} />
        <div className="panes">
          {[decade, decade + 10].map((dec) => (
            <div key={dec} className="calendar">
              {yearsGrid(dec, (y) => rangeTone(new Date(y, 0, 1), yearUnit), (y) => pickRange(new Date(y, 0, 1)))}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className={cn('picker-panel', className)} data-mode={mode}>
      {arrow ? <PickerPopupArrow className="picker-popup-arrow" /> : null}
      {body}
      {footer}
    </div>
  );
}

/* ───────────── 欄位 ───────────── */

export type DatePickerProps = {
  mode?: PickerMode;
  value: Date | PickerRange | null;
  onChange: (value: Date | PickerRange) => void;
  label?: ReactNode;
  ariaLabel?: string;
  required?: boolean;
  help?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  fieldStyle?: FieldStyle;
  showSeconds?: boolean;
  /** 寬度填滿父層（預設）；false＝規格樣本寬 240 */
  fluid?: boolean;
  className?: string;
};

export function DatePicker({
  mode = 'date', value, onChange, label, ariaLabel, required = false, help, placeholder = '請選擇',
  disabled = false, fieldStyle = 'tonal-theme', showSeconds = true, fluid = true, className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const text = formatPickerValue(mode, value, showSeconds);
  // 狀態優先序：Disabled → Focus（面板展開）→ Active（有值）→ Default（規格 §1）
  const state = disabled ? 'disabled' : open ? 'focus' : text ? 'active' : 'default';
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return (
    <div className={cn('picker', className)} data-fluid={fluid ? 'true' : undefined}>
      {label != null ? (
        <span id={labelId} className="picker-label text-body-s-bold">
          {required ? <b aria-hidden>*</b> : null}
          {label}
        </span>
      ) : null}
      <button
        ref={anchor}
        type="button"
        className="picker-field text-body-s"
        data-style={fieldStyle}
        data-state={state}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={label != null ? labelId : undefined}
        aria-label={label == null ? ariaLabel : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn('field-value min-w-0 truncate', !text && 'placeholder')}>{text || placeholder}</span>
        {mode === 'time' ? <PickerTimeIcon className="picker-suffix" /> : <PickerDateIcon className="picker-suffix" />}
      </button>
      {help != null ? <p className="picker-help text-body-xs">{help}</p> : null}
      <AnchoredPopover open={open} anchorRef={anchor} onClose={() => setOpen(false)} role="dialog" ariaLabel={typeof label === 'string' ? label : ariaLabel ?? '選擇日期'} align="start" offset={12} autoFocus={false}>
        <DatePickerPanel
          mode={mode}
          value={value}
          arrow
          showSeconds={showSeconds}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
            anchor.current?.focus();
          }}
        />
      </AnchoredPopover>
    </div>
  );
}
