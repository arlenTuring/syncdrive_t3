import { Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { AnchoredPopover } from '../lib/AnchoredPopover';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
type Rgba = { r: number; g: number; b: number; a: number };
const PALETTE = ['#0ea5e9', '#2563eb', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ffffff', '#71717a', '#27272a', '#000000'];

function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const short = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/.exec(value);
  if (short) return { r: parseInt(short[1] + short[1], 16), g: parseInt(short[2] + short[2], 16), b: parseInt(short[3] + short[3], 16), a: short[4] ? parseInt(short[4] + short[4], 16) / 255 : 1 };
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/.exec(value);
  if (hex) return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: hex[4] ? parseInt(hex[4], 16) / 255 : 1 };
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!rgba) return null;
  return { r: Math.min(255, Number(rgba[1])), g: Math.min(255, Number(rgba[2])), b: Math.min(255, Number(rgba[3])), a: Math.max(0, Math.min(1, Number(rgba[4] ?? 1))) };
}

const hex2 = (value: number) => Math.round(value).toString(16).padStart(2, '0');
const hexColor = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const cssColor = (color: Rgba) => color.a >= 1 ? hexColor(color) : `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 100) / 100})`;

/** 深色 HEX／透明度選擇器；不開啟作業系統原生色彩面板。 */
export function SiteColorInput({ value, onChange, disabled, className = '', name, title, 'aria-label': ariaLabel }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const source = String(value ?? '#000000');
  const parsed = parseColor(source) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [draft, setDraft] = useState(source);
  useEffect(() => setDraft(source), [source]);

  const emit = (next: string) => {
    const target = { value: next, name } as HTMLInputElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
  };
  const updateAlpha = (alpha: number) => emit(cssColor({ ...parsed, a: alpha }));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel || title || `選擇色彩 ${source}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`relative overflow-hidden border border-zinc-700 bg-transparent disabled:opacity-50 ${className}`}
        style={{ backgroundColor: source }}
      >
        <span className="absolute inset-0 bg-[linear-gradient(45deg,#777_25%,transparent_25%,transparent_75%,#777_75%),linear-gradient(45deg,#777_25%,#fff_25%,#fff_75%,#777_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] opacity-20" aria-hidden />
        <Pipette className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        role="dialog"
        ariaLabel={ariaLabel || title || '選擇色彩'}
        className="w-64 rounded-xl border border-zinc-700 bg-[#18181b] p-3 shadow-xl shadow-black/50"
      >
        <div className="mb-3 grid grid-cols-6 gap-2">
          {PALETTE.map((color) => <button key={color} type="button" aria-label={color} onClick={() => emit(color)} className="size-7 rounded border border-white/20" style={{ backgroundColor: color }} />)}
        </div>
        <label className="block text-xs text-zinc-400">
          HEX / CSS 色彩
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (parseColor(draft)) emit(draft.trim()); else setDraft(source); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && parseColor(draft)) { emit(draft.trim()); setOpen(false); } }}
            className={`mt-1 w-full rounded-lg border bg-zinc-900 px-2 py-1.5 font-mono text-sm text-zinc-100 outline-none ${parseColor(draft) ? 'border-zinc-700 focus:border-sky-500' : 'border-red-500'}`}
          />
        </label>
        <label className="mt-3 block text-xs text-zinc-400">
          透明度 {Math.round(parsed.a * 100)}%
          <input type="range" min={0} max={100} value={Math.round(parsed.a * 100)} onChange={(event) => updateAlpha(Number(event.target.value) / 100)} className="mt-1 w-full accent-sky-500" />
        </label>
      </AnchoredPopover>
      {name ? <input type="hidden" name={name} value={source} /> : null}
    </>
  );
}
