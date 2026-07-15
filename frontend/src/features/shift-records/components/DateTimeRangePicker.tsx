import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CustomDateTimePanel } from './CustomDateTimePanel';

export type DateTimeRange = {
  start: Date | null;
  end: Date | null;
};

type DateTimeRangePickerProps = {
  value: DateTimeRange;
  onChange: (next: DateTimeRange) => void;
};

type OpenField = 'start' | 'end' | null;

function formatRangeLabel(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${mo}/${day} ${hh}:${mm}`;
}

export function dateToPlannedStartMs(d: Date | null): string | undefined {
  if (!d) return undefined;
  return String(d.getTime());
}

export function hasDateTimeRangeFilter(range: DateTimeRange): boolean {
  return range.start != null || range.end != null;
}

const POPOVER_WIDTH = 420;
const VIEWPORT_MARGIN = 12;

function clampPopoverLeft(
  anchorRect: DOMRect,
  field: 'start' | 'end',
  rangeRect: DOMRect | null,
  width: number,
): number {
  const w = Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2);
  const rect = field === 'end' && rangeRect ? rangeRect : anchorRect;
  const left = field === 'end' ? rect.right - w : rect.left;
  return Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - w - VIEWPORT_MARGIN));
}

function FieldDateTimePopover({
  field,
  anchorRef,
  rangeRef,
  value,
  onClose,
  onConfirm,
}: {
  field: 'start' | 'end';
  anchorRef: RefObject<HTMLElement | null>;
  rangeRef: RefObject<HTMLElement | null>;
  value: Date | null;
  onClose: () => void;
  onConfirm: (next: Date | null) => void;
}) {
  const titleId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, caretLeft: 24 });

  const updatePosition = () => {
    const anchor = anchorRef.current;
    const range = rangeRef.current;
    const popover = popoverRef.current;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const rangeRect = range?.getBoundingClientRect() ?? null;
    const width = popover?.offsetWidth ?? POPOVER_WIDTH;
    const left = clampPopoverLeft(anchorRect, field, rangeRect, width);
    const caretLeft = Math.max(16, Math.min(anchorRect.left + anchorRect.width / 2 - left - 6, width - 24));
    setPos({
      top: anchorRect.bottom + 10,
      left,
      caretLeft,
    });
  };

  useLayoutEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, rangeRef, field]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      if (rangeRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [anchorRef, rangeRef, onClose]);

  const label = field === 'start' ? '選擇開始時間' : '選擇結束時間';

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed z-[10001] w-[min(420px,calc(100vw-24px))] rounded-xl border border-zinc-700/90 bg-[#141416] shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
    >
      <span id={titleId} className="sr-only">
        {label}
      </span>
      <div
        className="absolute -top-[7px] size-3 rotate-45 border border-b-0 border-r-0 border-zinc-700/90 bg-[#141416]"
        style={{ left: pos.caretLeft }}
        aria-hidden
      />

      <CustomDateTimePanel
        key={`${field}-${value?.getTime() ?? 'empty'}`}
        value={value}
        onConfirm={(next) => onConfirm(next)}
      />
    </div>
  );
}

export function DateTimeRangePicker({ value, onChange }: DateTimeRangePickerProps) {
  const [openField, setOpenField] = useState<OpenField>(null);
  const rangeRef = useRef<HTMLDivElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const endBtnRef = useRef<HTMLButtonElement>(null);
  const iconBtnRef = useRef<HTMLButtonElement>(null);

  const open = (field: 'start' | 'end') => {
    setOpenField((prev) => (prev === field ? null : field));
  };

  const anchorRef = openField === 'start' ? startBtnRef : openField === 'end' ? endBtnRef : iconBtnRef;

  const confirmField = (field: 'start' | 'end', next: Date | null) => {
    onChange({
      ...value,
      [field]: next,
    });
    setOpenField(null);
  };

  const startLabel = formatRangeLabel(value.start);
  const endLabel = formatRangeLabel(value.end);

  const fieldBtnClass = (hasValue: boolean, active: boolean) =>
    `inline-flex shrink-0 items-center justify-start whitespace-nowrap py-2.5 text-left transition hover:text-zinc-200 ${
      active ? 'text-sky-300' : hasValue ? 'text-zinc-200' : 'text-zinc-500'
    }`;

  return (
    <>
      <div
        ref={rangeRef}
        className="flex w-full min-w-[400px] max-w-[520px] shrink-0 flex-nowrap items-stretch overflow-hidden rounded-lg border border-zinc-700/90 bg-[#1c1c1e] text-sm"
        role="group"
        aria-label="班次時間區間"
      >
        <div className="flex min-w-0 flex-1 items-center justify-start py-0 pl-4 pr-2">
          <button
            ref={startBtnRef}
            type="button"
            onClick={() => open('start')}
            className={fieldBtnClass(!!startLabel, openField === 'start')}
          >
            {startLabel ?? '開始'}
          </button>
          {!startLabel && (
            <span className="inline-block w-[7.5rem] shrink-0" aria-hidden />
          )}
          <span className="shrink-0 px-2 text-zinc-600" aria-hidden>
            →
          </span>
          <button
            ref={endBtnRef}
            type="button"
            onClick={() => open('end')}
            className={fieldBtnClass(!!endLabel, openField === 'end')}
          >
            {endLabel ?? '結束'}
          </button>
          {!endLabel && startLabel && (
            <span className="inline-block w-[7.5rem] shrink-0" aria-hidden />
          )}
        </div>
        <button
          ref={iconBtnRef}
          type="button"
          onClick={() => open(value.start ? 'end' : 'start')}
          className="flex w-11 shrink-0 items-center justify-center border-l border-zinc-700/80 opacity-90 transition hover:opacity-100"
          title="選擇日期與時間"
        >
          <img
            src="/shift-mgt-icons/timepick.png"
            alt=""
            className="size-4"
            width={16}
            height={16}
          />
        </button>
      </div>

      {openField && (
        <FieldDateTimePopover
          field={openField}
          anchorRef={anchorRef}
          rangeRef={rangeRef}
          value={openField === 'start' ? value.start : value.end}
          onClose={() => setOpenField(null)}
          onConfirm={(next) => confirmField(openField, next)}
        />
      )}
    </>
  );
}
