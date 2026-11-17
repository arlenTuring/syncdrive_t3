import { Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { snapSecondsToScheduleAlign } from '../types/editor';
import { TimePickerPanel } from './TimeOfDayPicker';
import { IconButton } from '../../../components/ui';

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
        className={`flex h-[34px] min-w-0 items-center rounded-lg bg-surface-primary px-3 text-body-s leading-[18px] tracking-[0.5px] ${
          open ? 'ring-1 ring-border-theme-light' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => openPicker('start')}
          className={`shrink-0 whitespace-nowrap tabular-nums ${
            active === 'start' && open ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {startTime || '--:--'}
        </button>
        <span className="mx-2 shrink-0 text-text-quaternary">→</span>
        <button
          type="button"
          onClick={() => openPicker('end')}
          className={`shrink-0 whitespace-nowrap tabular-nums ${
            active === 'end' && open ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {endTime || '--:--'}
        </button>
        <IconButton size="small" hierarchy="subordinate" variant="standard" className="ml-auto shrink-0" onPress={() => openPicker(active)} label="選擇時間" icon={<Clock />} />
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
