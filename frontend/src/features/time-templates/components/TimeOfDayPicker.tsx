import { Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  INTERVAL_TABLE_FIELD_HEIGHT_PX,
  SCHEDULE_TIME_ALIGN_SECONDS,
  snapSecondsToScheduleAlign,
} from '../types/editor';
import { Button, cn, fieldClass, PickerPopupArrow, PickerTimeColumns, type TimePart } from '../../../components/ui';

/** 欄位外觀照 TextField 規格（.t3-input）；高度由表格列決定（FIELD_STYLE） */
const FIELD_CLASS = cn(fieldClass({ size: 'md' }), 'text-left');

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


type TimePickerPanelProps = {
  hour: number;
  minute: number;
  second: number;
  onHourChange: (n: number) => void;
  onMinuteChange: (n: number) => void;
  onSecondChange?: (n: number) => void;
  /** 沒給就不顯示「此刻」（例如要以營運時鐘為準、不能拿瀏覽器時間的地方） */
  onNow?: () => void;
  onConfirm: () => void;
  /** false：只選時、分（24 小時制） */
  showSeconds?: boolean;
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
  showSeconds = true,
}: TimePickerPanelProps) {
  // DatePicker 規格的 Time 面板：時、分、秒三欄（自繪捲軸）、頂端指向箭頭、底部「此刻」「確定」
  const parts: TimePart[] = [
    { label: '時', value: hour, max: 23, onChange: onHourChange },
    { label: '分', value: minute, max: 59, onChange: onMinuteChange },
  ];
  if (showSeconds && onSecondChange) {
    parts.push({ label: '秒', value: second, max: 50, step: SCHEDULE_TIME_ALIGN_SECONDS, onChange: onSecondChange });
  }
  return (
    <div className="picker-panel" data-mode="time">
      <PickerPopupArrow className="picker-popup-arrow" />
      <PickerTimeColumns parts={parts} />
      <footer>
        {onNow ? <Button variant="text" onPress={onNow}>此刻</Button> : <span className="picker-footer-spacer" />}
        <Button onPress={onConfirm}>確定</Button>
      </footer>
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
          open ? 'ring-1 ring-border-theme-light' : ''
        } ${value ? 'text-text-secondary' : 'text-text-tertiary'}`}
        style={FIELD_STYLE}
      >
        {displayText}
      </button>
      <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[240]"
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
