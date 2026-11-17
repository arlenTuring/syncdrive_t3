import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AnchoredPopover } from '../../lib/AnchoredPopover';
import type { SourceOption } from './api';
import { groupSources } from './layout';
import { OPTION_STATE_LABEL } from './status';
import { MENU_PANEL_CLASS, cn, fieldClass } from '../../components/ui';

const STATE_TONE: Partial<Record<SourceOption['state'], string>> = {
  online: 'text-status-success',
  offline: 'text-status-error-emphasis',
  error: 'text-status-error-emphasis',
  disabled: 'text-text-quaternary',
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
        className={cn(fieldClass({ fullWidth: false }), 'flex items-center justify-between gap-2 text-left', className)}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-text-tertiary'}`}>{selected?.name ?? placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 text-text-quaternary transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="dialog"
        ariaLabel={ariaLabel}
        align="start"
        className={cn(MENU_PANEL_CLASS, 'flex max-h-96 flex-col overflow-hidden py-0')}
        style={{ width: panelWidth }}
      >
        <div className="flex items-center gap-2 border-b border-border-quaternary px-3 py-2">
          <Search className="size-4 shrink-0 text-text-quaternary" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋名稱、標籤、載具、位置"
            aria-label="搜尋影像來源"
            className="h-7 min-w-0 flex-1 bg-transparent text-body-s text-text-primary outline-none placeholder:text-text-quaternary"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label={ariaLabel}>
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="px-3 py-1.5 text-body-xs-bold text-text-quaternary">{group.label}</div>
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
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-body-s transition-colors disabled:cursor-not-allowed ${active ? 'bg-surface-theme text-text-theme' : 'text-text-primary hover:bg-link-standard'} ${blocked ? 'opacity-50' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1 text-body-xs text-text-tertiary">
                        {o.vehicleCode ? <span>{o.vehicleCode}</span> : null}
                        {o.location ? <span>・{o.location}</span> : null}
                        {o.tags.slice(1).map((t) => <span key={t} className="rounded bg-surface-secondary px-1">{t}</span>)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-body-xs ${STATE_TONE[o.state] ?? 'text-text-tertiary'}`}>{OPTION_STATE_LABEL[o.state]}</span>
                    {active ? <Check className="size-4 shrink-0 text-text-theme" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 ? <div className="px-3 py-3 text-body-s text-text-quaternary">{selectable.length ? '找不到符合的來源' : '還沒有影像來源，請先到「影像資源管理」新增'}</div> : null}
        </div>
      </AnchoredPopover>
    </>
  );
}
