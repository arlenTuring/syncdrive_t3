import { CalendarClock } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { CustomDateTimePanel } from '../features/shift-records/components/CustomDateTimePanel';
import { AnchoredPopover } from '../lib/AnchoredPopover';

type Kind = 'date' | 'time' | 'datetime-local';
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { type: Kind };

const pad = (value: number) => String(value).padStart(2, '0');

function parse(value: string, kind: Kind): Date | null {
  const date = new Date();
  if (kind === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }
  if (kind === 'time') {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) return null;
    date.setHours(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 0);
    return date;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0))
    : null;
}

function format(value: Date, kind: Kind, seconds: boolean): string {
  const ymd = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  if (kind === 'date') return ymd;
  const hms = `${pad(value.getHours())}:${pad(value.getMinutes())}${seconds ? `:${pad(value.getSeconds())}` : ''}`;
  return kind === 'time' ? hms : `${ymd}T${hms}`;
}

function displayDateTimeValue(value: string, kind: Kind): string {
  if (!value) return '';
  return kind === 'datetime-local' ? value.replace('T', ' ') : value;
}

/** 日期／時間輸入的網站深色面板；值格式維持原生 input 契約。 */
export function SiteDateTimeInput({
  type,
  value,
  onChange,
  disabled,
  className = '',
  min,
  max,
  step,
  name,
  id,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = String(value ?? '');
  const includeSeconds = type === 'datetime-local' || current.split(':').length > 2 || Number(step) <= 1;
  const emit = (nextDate: Date) => {
    let next = format(nextDate, type, includeSeconds);
    if (typeof min === 'string' && next < min) next = min;
    if (typeof max === 'string' && next > max) next = max;
    const target = { value: next, name } as HTMLInputElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-site-datetime-value={current}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className={`flex min-w-0 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className={`min-w-0 whitespace-nowrap tabular-nums ${current ? '' : 'text-zinc-500'}`}>{displayDateTimeValue(current, type) || (type === 'time' ? '--:--' : '請選擇日期時間')}</span>
        <CalendarClock className="size-4 shrink-0 text-zinc-500" aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        role="dialog"
        ariaLabel={ariaLabel || title || '選擇日期時間'}
        align="start"
        offset={8}
        autoFocus={false}
        className="w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-xl border border-zinc-700/90 bg-[#141416] shadow-2xl shadow-black/50"
      >
        <CustomDateTimePanel key={`${type}-${current}`} value={parse(current, type)} onConfirm={emit} />
      </AnchoredPopover>
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </>
  );
}
