import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../../components/ui';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type CalendarCell = {
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
};

function buildCalendarCells(viewYear: number, viewMonth: number): CalendarCell[] {
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonth = new Date(viewYear, viewMonth, 0);
  const prevDays = prevMonth.getDate();
  const prevYear = prevMonth.getFullYear();
  const prevMonthIdx = prevMonth.getMonth();

  const cells: CalendarCell[] = [];

  for (let i = firstDow - 1; i >= 0; i -= 1) {
    cells.push({
      year: prevYear,
      month: prevMonthIdx,
      day: prevDays - i,
      inMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ year: viewYear, month: viewMonth, day, inMonth: true });
  }

  const nextMonth = new Date(viewYear, viewMonth + 1, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      year: nextMonth.getFullYear(),
      month: nextMonth.getMonth(),
      day: nextDay,
      inMonth: false,
    });
    nextDay += 1;
  }

  return cells;
}

function isSameDay(a: Date, y: number, m: number, d: number): boolean {
  return a.getFullYear() === y && a.getMonth() === m && a.getDate() === d;
}

function TimeColumn({
  max,
  value,
  onChange,
}: {
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current?.children[value] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center' });
  }, [value]);

  return (
    <div
      ref={ref}
      className="h-[212px] w-11 overflow-y-auto scroll-smooth border-l border-border-quaternary first:border-l-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {Array.from({ length: max + 1 }, (_, n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex h-8 w-full items-center justify-center font-mono text-body-s transition ${
            value === n
              ? 'bg-sky-600/35 font-medium text-text-theme'
              : 'text-text-quaternary hover:bg-surface-secondary hover:text-text-secondary'
          }`}
        >
          {String(n).padStart(2, '0')}
        </button>
      ))}
    </div>
  );
}

export type CustomDateTimePanelProps = {
  value: Date | null;
  onConfirm: (next: Date) => void;
};

export function CustomDateTimePanel({ value, onConfirm }: CustomDateTimePanelProps) {
  const { t } = useTranslation();
  const today = new Date();
  const initial = value ?? today;

  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [selYear, setSelYear] = useState(initial.getFullYear());
  const [selMonth, setSelMonth] = useState(initial.getMonth());
  const [selDay, setSelDay] = useState(initial.getDate());
  const [hour, setHour] = useState(value?.getHours() ?? 0);
  const [minute, setMinute] = useState(value?.getMinutes() ?? 0);
  const [second, setSecond] = useState(value?.getSeconds() ?? 0);

  const cells = buildCalendarCells(viewYear, viewMonth);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const shiftYear = (delta: number) => {
    setViewYear((y) => y + delta);
  };

  const pickDay = (cell: CalendarCell) => {
    setSelYear(cell.year);
    setSelMonth(cell.month);
    setSelDay(cell.day);
    if (!cell.inMonth) {
      setViewYear(cell.year);
      setViewMonth(cell.month);
    }
  };

  const handleConfirm = () => {
    onConfirm(new Date(selYear, selMonth, selDay, hour, minute, second, 0));
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border-quaternary px-3 py-2.5">
        <div className="flex items-center gap-0.5">
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() => shiftYear(-1)} label={t('shiftRecords.datePicker.prevYear')} icon={<ChevronsLeft />} />
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() => shiftMonth(-1)} label={t('shiftRecords.datePicker.prevMonth')} icon={<ChevronLeft />} />
        </div>
        <span className="text-body-s-bold text-text-primary">
          {t(`shiftRecords.datePicker.months.m${viewMonth}`)} {viewYear}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() => shiftMonth(1)} label={t('shiftRecords.datePicker.nextMonth')} icon={<ChevronRight />} />
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() => shiftYear(1)} label={t('shiftRecords.datePicker.nextYear')} icon={<ChevronsRight />} />
        </div>
      </div>

      <div className="flex">
        <div className="min-w-0 flex-1 p-3 pr-2">
          <div className="mb-2 grid grid-cols-7 text-center text-body-xs text-text-quaternary">
            {WEEKDAY_KEYS.map((w) => (
              <div key={w} className="py-1">
                {t(`shiftRecords.datePicker.weekdays.${w}`)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {cells.map((cell, idx) => {
              const selected =
                cell.year === selYear && cell.month === selMonth && cell.day === selDay;
              const isToday = isSameDay(today, cell.year, cell.month, cell.day);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => pickDay(cell)}
                  className={`mx-auto flex size-8 items-center justify-center rounded-full text-body-s transition ${
                    selected
                      ? 'bg-sky-600 font-medium text-text-primary'
                      : cell.inMonth
                        ? 'text-text-primary hover:bg-link-standard-hover'
                        : 'text-text-disabled hover:bg-link-standard'
                  } ${isToday && !selected ? 'ring-1 ring-dashed ring-zinc-400' : ''}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 border-l border-border-quaternary py-2">
          <TimeColumn max={23} value={hour} onChange={setHour} />
          <TimeColumn max={59} value={minute} onChange={setMinute} />
          <TimeColumn max={59} value={second} onChange={setSecond} />
        </div>
      </div>

      <div className="flex justify-end border-t border-border-quaternary px-3 py-2.5">
        <Button onPress={handleConfirm}>{t('shiftRecords.datePicker.confirm')}</Button>
      </div>
    </div>
  );
}
