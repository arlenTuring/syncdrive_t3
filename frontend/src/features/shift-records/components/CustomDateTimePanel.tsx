import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
] as const;

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
      className="h-[212px] w-11 overflow-y-auto scroll-smooth border-l border-zinc-800/80 first:border-l-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {Array.from({ length: max + 1 }, (_, n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`flex h-8 w-full items-center justify-center font-mono text-sm transition ${
            value === n
              ? 'bg-sky-600/35 font-medium text-sky-100'
              : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
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
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2.5">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => shiftYear(-1)}
            className="inline-flex size-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="上一年"
          >
            <ChevronsLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="inline-flex size-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="上個月"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>
        <span className="text-sm font-medium text-zinc-100">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="inline-flex size-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="下個月"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftYear(1)}
            className="inline-flex size-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="下一年"
          >
            <ChevronsRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex">
        <div className="min-w-0 flex-1 p-3 pr-2">
          <div className="mb-2 grid grid-cols-7 text-center text-xs text-zinc-500">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
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
                  className={`mx-auto flex size-8 items-center justify-center rounded-full text-sm transition ${
                    selected
                      ? 'bg-sky-600 font-medium text-white'
                      : cell.inMonth
                        ? 'text-zinc-200 hover:bg-zinc-800'
                        : 'text-zinc-600 hover:bg-zinc-800/50'
                  } ${isToday && !selected ? 'ring-1 ring-dashed ring-zinc-400' : ''}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 border-l border-zinc-800/80 py-2">
          <TimeColumn max={23} value={hour} onChange={setHour} />
          <TimeColumn max={59} value={minute} onChange={setMinute} />
          <TimeColumn max={59} value={second} onChange={setSecond} />
        </div>
      </div>

      <div className="flex justify-end border-t border-zinc-800/80 px-3 py-2.5">
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded-lg bg-sky-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          確定
        </button>
      </div>
    </div>
  );
}