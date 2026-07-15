import { Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  INTERVAL_TABLE_FIELD_HEIGHT_PX,
  SCHEDULE_TIME_ALIGN_SECONDS,
  snapSecondsToScheduleAlign,
} from '../types/editor';

const FIELD_CLASS =
  'w-full rounded-lg bg-[rgba(142,197,255,0.08)] px-3 text-left text-sm leading-[18px] tracking-[0.5px] text-[#D1D5DC] focus:outline-none';

const FIELD_STYLE = { height: INTERVAL_TABLE_FIELD_HEIGHT_PX };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseHm(value: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return { hour: 0, minute: 0, second: 0 };
  const second = snapSecondsToScheduleAlign(match[3] != null ? Number(match[3]) : 0);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Math.min(50, second),
  };
}

function formatHm(hour: number, minute: number, second = 0): string {
  const snapped = snapSecondsToScheduleAlign(second);
  if (snapped === 0) return `${pad2(hour)}:${pad2(minute)}`;
  return `${pad2(hour)}:${pad2(minute)}:${pad2(snapped)}`;
}

function TimeColumn({
  max,
  value,
  onChange,
  step = 1,
}: {
  max: number;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const values = Array.from(
    { length: Math.floor(max / step) + 1 },
    (_, i) => i * step,
  );
  const selectedIndex = Math.max(0, values.indexOf(value));

  useLayoutEffect(() => {
    const el = ref.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center' });
  }, [selectedIndex]);

  return (
    <div
      ref={ref}
      className="h-[264px] w-[60px] overflow-y-auto py-1 pl-1 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {values.map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="mb-0 flex h-8 w-12 items-center justify-center"
          >
            <span
              className={`flex h-8 w-12 items-center justify-center rounded-lg text-sm tracking-[0.5px] ${
                selected
                  ? 'bg-[rgba(81,162,255,0.24)] font-medium text-[#D1D5DC]'
                  : 'font-normal text-[#D1D5DC] hover:bg-zinc-800/50'
              }`}
            >
              {pad2(n)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type TimePickerPanelProps = {
  hour: number;
  minute: number;
  second: number;
  onHourChange: (n: number) => void;
  onMinuteChange: (n: number) => void;
  onSecondChange: (n: number) => void;
  onNow: () => void;
  onConfirm: () => void;
};

export function TimePickerPanel({
  hour,
  minute,
  second,
  onHourChange,
  onMinuteChange,
  onSecondChange,
  onNow,
  onConfirm,
}: TimePickerPanelProps) {
  return (
    <div className="relative w-[190px] rounded-xl bg-[#18181B] shadow-[0px_4px_24px_rgba(98,116,142,0.2)]">
      <div
        className="absolute -top-2 left-6 size-0 border-x-8 border-b-8 border-x-transparent border-b-[#27272A]"
        aria-hidden
      />
      <div className="p-1">
        <div className="flex rounded-lg p-1">
          <TimeColumn max={23} value={hour} onChange={onHourChange} />
          <div className="w-px self-stretch bg-[rgba(212,212,212,0.15)]" />
          <TimeColumn max={59} value={minute} onChange={onMinuteChange} />
          <div className="w-px self-stretch bg-[rgba(212,212,212,0.15)]" />
          <TimeColumn
            max={50}
            value={second}
            onChange={onSecondChange}
            step={SCHEDULE_TIME_ALIGN_SECONDS}
          />
        </div>
      </div>
      <div className="h-px w-full bg-[rgba(212,212,212,0.15)]" />
      <div className="flex items-center justify-between px-2 py-2">
        <button
          type="button"
          onClick={onNow}
          className="rounded-lg px-3.5 py-2 text-sm font-medium tracking-[0.5px] text-[#51A2FF] hover:bg-[#51A2FF]/10"
        >
          此刻
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium tracking-[0.5px] text-white hover:bg-[#2569e6]"
        >
          確定
        </button>
      </div>
    </div>
  );
}

type TimeOfDayPickerRole = 'start' | 'end';

function normalizePickerValue(value: string, role: TimeOfDayPickerRole): string {
  const trimmed = value.trim();
  if (role === 'end' && (trimmed === '24:00' || trimmed.startsWith('24:00:'))) {
    return '00:00';
  }
  return trimmed;
}

type TimeOfDayPickerProps = {
  value: string;
  label: string;
  role?: TimeOfDayPickerRole;
  onChange: (value: string) => void;
};

export function TimeOfDayPicker({ value, label, role = 'start', onChange }: TimeOfDayPickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseHm(normalizePickerValue(value, role));
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [second, setSecond] = useState(parsed.second);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const parsedValue = parseHm(normalizePickerValue(value, role));
    setHour(parsedValue.hour);
    setMinute(parsedValue.minute);
    setSecond(parsedValue.second);
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const panelHeight = 323;
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const top =
        spaceBelow >= panelHeight
          ? rect.bottom + gap
          : Math.max(gap, rect.top - panelHeight - gap);
      setPanelPos({ top, left: rect.left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const displayValue = value ? normalizePickerValue(value, role) : '';
  const displayText = displayValue ? `${label}:${displayValue}` : `${label}:--`;

  const handleConfirm = () => {
    onChange(formatHm(hour, minute, second));
    setOpen(false);
  };

  const handleNow = () => {
    const now = new Date();
    setHour(now.getHours());
    setMinute(now.getMinutes());
    setSecond(Math.min(50, snapSecondsToScheduleAlign(now.getSeconds())));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`${FIELD_CLASS} relative w-full pr-9 ${
          open ? 'ring-1 ring-[#2B7FFF]/60' : ''
        } ${value ? 'text-[#D1D5DC]' : 'text-[#99A1AF]'}`}
        style={FIELD_STYLE}
      >
        {displayText}
      </button>
      <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#99A1AF]" />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[200]"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            <TimePickerPanel
              hour={hour}
              minute={minute}
              second={second}
              onHourChange={setHour}
              onMinuteChange={setMinute}
              onSecondChange={setSecond}
              onNow={handleNow}
              onConfirm={handleConfirm}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
