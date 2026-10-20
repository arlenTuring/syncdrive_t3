import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AnchoredPopover } from '../../lib/AnchoredPopover';
import type { SourceOption } from './api';
import { groupSources } from './layout';
import { OPTION_STATE_LABEL } from './status';

const STATE_TONE: Partial<Record<SourceOption['state'], string>> = {
  online: 'text-emerald-300',
  offline: 'text-red-300',
  error: 'text-red-300',
  disabled: 'text-zinc-500',
};

/**
 * 可搜尋、依來源標籤分組的來源選單（本站下拉樣式）。只列安全摘要，不含任何連線資訊。
 * 停用與已刪除的來源不能選（但目前已綁定的仍會顯示在按鈕上）；離線但啟用的可以選，畫面會提示等待恢復。
 */
export function SourcePicker({
  options,
  value,
  onPick,
  disabled,
  placeholder = '選擇影像來源',
  className = '',
  ariaLabel = '選擇影像來源',
}: {
  options: SourceOption[];
  value: string | null;
  onPick: (sourceId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(280);
  const [query, setQuery] = useState('');
  const selectable = useMemo(() => options.filter((o) => !o.deleted), [options]);
  const groups = useMemo(() => groupSources(selectable, query), [selectable, query]);
  const selected = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setPanelWidth(Math.max(anchorRef.current?.getBoundingClientRect().width ?? 0, 280));
          setOpen((v) => !v);
        }}
        className={`flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg bg-[#262a33] px-3 text-left text-sm text-zinc-100 outline-none hover:bg-[#2d323d] focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-zinc-400'}`}>{selected?.name ?? placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="dialog"
        ariaLabel={ariaLabel}
        align="start"
        className="flex max-h-96 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-[#18181b] shadow-xl shadow-black/50"
        style={{ width: panelWidth }}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search className="size-4 shrink-0 text-zinc-500" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋名稱、標籤、載具、位置"
            aria-label="搜尋影像來源"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]" role="listbox" aria-label={ariaLabel}>
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="px-3 py-1.5 text-xs font-medium text-zinc-500">{group.label}</div>
              {group.items.map((o) => {
                const active = o.id === value;
                const blocked = !o.enabled;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-disabled={blocked || undefined}
                    disabled={blocked}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      onPick(o.id);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed ${active ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-100 hover:bg-white/5'} ${blocked ? 'opacity-50' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-zinc-400">
                        {o.vehicleCode ? <span>{o.vehicleCode}</span> : null}
                        {o.location ? <span>・{o.location}</span> : null}
                        {o.tags.slice(1).map((t) => <span key={t} className="rounded bg-zinc-800 px-1">{t}</span>)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs ${STATE_TONE[o.state] ?? 'text-zinc-400'}`}>{OPTION_STATE_LABEL[o.state]}</span>
                    {active ? <Check className="size-4 shrink-0 text-sky-400" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 ? <div className="px-3 py-3 text-sm text-zinc-500">{selectable.length ? '找不到符合的來源' : '還沒有影像來源，請先到「影像資源管理」新增'}</div> : null}
        </div>
      </AnchoredPopover>
    </>
  );
}
