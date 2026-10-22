import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AnchoredPopover } from '../lib/AnchoredPopover';

export type SiteMultiSelectOption = {
  value: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
};

export function SiteMultiSelect({
  values,
  options,
  onChange,
  ariaLabel,
  allLabel = '全部',
  maxSelections = 100,
  className = '',
}: {
  values: string[];
  options: SiteMultiSelectOption[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  allLabel?: string;
  maxSelections?: number;
  className?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(values), [values]);
  const labels = options.filter((option) => selected.has(option.value)).map((option) => option.label);
  const summary = labels.length === 0 ? allLabel : labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
  const toggle = (value: string) => {
    if (selected.has(value)) onChange(values.filter((item) => item !== value));
    else if (values.length < maxSelections) onChange([...values, value]);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-h-10 items-center justify-between gap-2 rounded-xl bg-[#222831] px-3 text-left text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-500 ${className}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate" title={labels.join('、') || allLabel}>{summary}</span>
        <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="listbox"
        ariaLabel={ariaLabel}
        ariaMultiselectable
        align="start"
        className="max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-[#18181b] py-1 shadow-xl shadow-black/50 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
        style={{ width: 280, maxWidth: 'calc(100vw - 24px)' }}
      >
        <button
          type="button"
          role="option"
          aria-selected={values.length === 0}
          className={`flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm ${values.length === 0 ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-100 hover:bg-white/5'}`}
          onClick={() => onChange([])}
        >
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          {values.length === 0 ? <Check className="size-4 shrink-0 text-sky-400" aria-hidden /> : null}
        </button>
        {options.map((option) => {
          const active = selected.has(option.value);
          const disabled = option.disabled || (!active && values.length >= maxSelections);
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              className={`flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm disabled:cursor-not-allowed disabled:text-zinc-600 ${active ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-100 hover:bg-white/5'}`}
              onClick={() => toggle(option.value)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.badge !== undefined ? <span className="shrink-0 text-xs text-zinc-500">{option.badge}</span> : null}
              {active ? <Check className="size-4 shrink-0 text-sky-400" aria-hidden /> : <span className="size-4 shrink-0 rounded border border-zinc-600" aria-hidden />}
            </button>
          );
        })}
        {options.length === 0 ? <div className="px-3 py-2 text-sm text-zinc-500">目前沒有來源標籤</div> : null}
      </AnchoredPopover>
    </>
  );
}
