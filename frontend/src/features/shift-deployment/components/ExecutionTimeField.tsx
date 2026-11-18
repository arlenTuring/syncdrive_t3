import { Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../components/ui';

const INPUT =
  'h-10 w-full rounded-lg border border-border-quaternary bg-surface-primary px-3 pr-9 text-left text-body-s text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light-trn';

type Period = 'am' | 'pm';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseHm(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return { hour: 12, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2]))),
  };
}

function to12h(hour24: number): { period: Period; hour12: number } {
  if (hour24 === 0) return { period: 'am', hour12: 12 };
  if (hour24 < 12) return { period: 'am', hour12: hour24 };
  if (hour24 === 12) return { period: 'pm', hour12: 12 };
  return { period: 'pm', hour12: hour24 - 12 };
}

function to24h(period: Period, hour12: number): number {
  if (period === 'am') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function formatHm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatLocalHm(d: Date): string {
  return formatHm(d.getHours(), d.getMinutes());
}

function WheelColumn<T extends string | number>({
  items,
  value,
  onChange,
  format = String,
}: {
  items: T[];
  value: T;
  onChange: (next: T) => void;
  format?: (item: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, items.indexOf(value));

  useLayoutEffect(() => {
    const el = ref.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center' });
  }, [selectedIndex]);

  return (
    <div
      ref={ref}
      className="h-[264px] w-[60px] overflow-y-auto py-1 pl-1 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const selected = item === value;
        return (
          <button
            key={String(item)}
            type="button"
            onClick={() => onChange(item)}
            className="mb-0 flex h-8 w-12 items-center justify-center"
          >
            <span
              className={`flex h-8 w-12 items-center justify-center rounded-lg text-body-s tracking-[0.5px] ${
                selected
                  ? 'bg-link-tonal font-medium text-text-secondary'
                  : 'font-normal text-text-secondary hover:bg-link-standard'
              }`}
            >
              {format(item)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type ExecutionTimeFieldProps = {
  value: string;
  onChange: (time: string) => void;
  /** 填入現在日期與時間後關閉選單 */
  onNow: () => void;
  placeholder?: string;
};

export function ExecutionTimeField({
  value,
  onChange,
  onNow,
  placeholder = '--:--',
}: ExecutionTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const parsed = to12h(parseHm(value).hour);
  const [period, setPeriod] = useState<Period>(parsed.period);
  const [hour12, setHour12] = useState(parsed.hour12);
  const [minute, setMinute] = useState(parseHm(value).minute);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const hm = parseHm(value);
    const next = to12h(hm.hour);
    setPeriod(next.period);
    setHour12(next.hour12);
    setMinute(hm.minute);
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const panelHeight = 330;
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

  const handleConfirm = () => {
    onChange(formatHm(to24h(period, hour12), minute));
    setOpen(false);
  };

  const handleNow = () => {
    onNow();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`${INPUT} truncate ${open ? 'border-border-theme ring-1 ring-link-theme-filled/30' : ''} ${
          value ? 'text-text-primary' : 'text-text-quaternary'
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {value || placeholder}
      </button>
      <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-quaternary" />
      {open &&
        createPortal(
          // 要高過共用對話框（Dialog z-230）：這個欄位常放在對話框裡，先前 z-200 被對話框蓋住，點了像沒反應
          <div
            ref={panelRef}
            className="fixed z-[240]"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            <div className="relative w-[196px] rounded-xl border border-border-quaternary bg-surface-primary shadow-[0px_4px_24px_rgba(98,116,142,0.2)]">
              <div className="p-1">
                <div className="flex rounded-lg p-1">
                  <WheelColumn
                    items={['am', 'pm'] as const}
                    value={period}
                    onChange={setPeriod}
                    format={(item) => (item === 'am' ? '上午' : '下午')}
                  />
                  <div className="w-px self-stretch bg-surface-secondary" />
                  <WheelColumn
                    items={HOURS_12}
                    value={hour12}
                    onChange={setHour12}
                    format={pad2}
                  />
                  <div className="w-px self-stretch bg-surface-secondary" />
                  <WheelColumn items={MINUTES} value={minute} onChange={setMinute} format={pad2} />
                </div>
              </div>
              <div className="h-px w-full bg-surface-secondary" />
              <div className="flex items-center justify-between px-2 py-2">
                <Button variant="text" onPress={handleNow}>此刻</Button>
                <Button onPress={handleConfirm}>確定</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
