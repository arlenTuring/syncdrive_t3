import { PickerDateIcon } from '../../../components/ui/datepicker/PickerIcons';
import { cn } from '../../../components/ui';
import { ArrowRight } from 'lucide-react';
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
      offset={12}
      autoFocus={false}
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

  // DatePicker 規格的欄位外觀（.picker-field）：高 34、圓角 8、tonal-theme 底；開啟中為 focus 框
  const fieldBtnClass = (hasValue: boolean, active: boolean) =>
    cn(
      'min-w-0 truncate text-left transition',
      active ? 'text-text-theme' : hasValue ? 'text-text-primary' : 'placeholder',
    );

  return (
    <>
      <div
        ref={rangeRef}
        className="picker-field text-body-s"
        data-state={openField ? 'focus' : 'default'}
        role="group"
        aria-label={t('shiftRecords.dateRange.aria')}
      >
        <button
          ref={startBtnRef}
          type="button"
          onClick={() => open('start')}
          className={cn(fieldBtnClass(!!startLabel, openField === 'start'), 'flex-1')}
        >
          {startLabel ?? t('shiftRecords.dateRange.start')}
        </button>
        <ArrowRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
        <button
          ref={endBtnRef}
          type="button"
          onClick={() => open('end')}
          className={cn(fieldBtnClass(!!endLabel, openField === 'end'), 'flex-1')}
        >
          {endLabel ?? t('shiftRecords.dateRange.end')}
        </button>
        <button
          ref={iconBtnRef}
          type="button"
          onClick={() => open(value.start ? 'end' : 'start')}
          className="flex shrink-0 items-center"
          title={t('shiftRecords.dateRange.selectDateTime')}
          aria-label={t('shiftRecords.dateRange.selectDateTime')}
        >
          <PickerDateIcon className="picker-suffix" />
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
