import { Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { snapSecondsToScheduleAlign } from '../types/editor';
import { TimePickerPanel } from './TimeOfDayPicker';

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

type TimeRangeFieldProps = {
  startTime: string;
  endTime: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
};

export function TimeRangeField({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: TimeRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<'start' | 'end'>('start');
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const [second, setSecond] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  const openPicker = (field: 'start' | 'end') => {
    const parsed = parseHm(field === 'start' ? startTime : endTime);
    setActive(field);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setSecond(parsed.second);
    setOpen(true);
  };

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
      setPanelPos({ top, left: Math.max(gap, rect.right - 190) });
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

  const handleConfirm = () => {
    const next = formatHm(hour, minute, second);
    if (active === 'start') onStartChange(next);
    else onEndChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div
        ref={triggerRef}
        className={`flex h-[34px] min-w-0 items-center rounded-lg bg-zinc-900/80 px-3 text-sm leading-[18px] tracking-[0.5px] ${
          open ? 'ring-1 ring-[#2B7FFF]/60' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => openPicker('start')}
          className={`shrink-0 whitespace-nowrap tabular-nums ${
            active === 'start' && open ? 'text-white' : 'text-[#D1D5DC] hover:text-white'
          }`}
        >
          {startTime || '--:--'}
        </button>
        <span className="mx-2 shrink-0 text-zinc-500">→</span>
        <button
          type="button"
          onClick={() => openPicker('end')}
          className={`shrink-0 whitespace-nowrap tabular-nums ${
            active === 'end' && open ? 'text-white' : 'text-[#D1D5DC] hover:text-white'
          }`}
        >
          {endTime || '--:--'}
        </button>
        <button
          type="button"
          onClick={() => openPicker(active)}
          className="ml-auto flex shrink-0 items-center justify-center text-[#99A1AF] hover:text-[#D1D5DC]"
          aria-label="選擇時間"
        >
          <Clock className="size-4" />
        </button>
      </div>
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
              onNow={() => {
                const now = new Date();
                setHour(now.getHours());
                setMinute(now.getMinutes());
                setSecond(Math.min(50, snapSecondsToScheduleAlign(now.getSeconds())));
              }}
              onConfirm={handleConfirm}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
