import { useId, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AnchoredPopover } from '../../../lib/AnchoredPopover';
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

function FieldDateTimePopover({
  open,
  field,
  anchorRef,
  value,
  onClose,
  onConfirm,
}: {
  open: boolean;
  field: 'start' | 'end';
  anchorRef: RefObject<HTMLElement | null>;
  value: Date | null;
  onClose: () => void;
  onConfirm: (next: Date | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();

  const label =
    field === 'start' ? t('shiftRecords.dateRange.selectStart') : t('shiftRecords.dateRange.selectEnd');

  return (
    <AnchoredPopover
      open={open}
      anchorRef={anchorRef}
      onClose={onClose}
      role="dialog"
      ariaLabel={label}
      align={field === 'end' ? 'end' : 'start'}
      offset={10}
      autoFocus={false}
      className="w-[min(420px,calc(100vw-24px))] rounded-xl border border-zinc-700/90 bg-[#141416] shadow-2xl shadow-black/50"
    >
      <span id={titleId} className="sr-only">
        {label}
      </span>
      <CustomDateTimePanel
        key={`${field}-${value?.getTime() ?? 'empty'}`}
        value={value}
        onConfirm={(next) => onConfirm(next)}
      />
    </AnchoredPopover>
  );
}

export function DateTimeRangePicker({ value, onChange }: DateTimeRangePickerProps) {
  const { t } = useTranslation();
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
        aria-label={t('shiftRecords.dateRange.aria')}
      >
        <div className="flex min-w-0 flex-1 items-center justify-start py-0 pl-4 pr-2">
          <button
            ref={startBtnRef}
            type="button"
            onClick={() => open('start')}
            className={fieldBtnClass(!!startLabel, openField === 'start')}
          >
            {startLabel ?? t('shiftRecords.dateRange.start')}
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
            {endLabel ?? t('shiftRecords.dateRange.end')}
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
          title={t('shiftRecords.dateRange.selectDateTime')}
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
          open
          field={openField}
          anchorRef={anchorRef}
          value={openField === 'start' ? value.start : value.end}
          onClose={() => setOpenField(null)}
          onConfirm={(next) => confirmField(openField, next)}
        />
      )}
    </>
  );
}
