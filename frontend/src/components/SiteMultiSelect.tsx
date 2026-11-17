import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { AnchoredPopover } from '../lib/AnchoredPopover';
import { CheckboxIndicator, cn, fieldClass, MENU_BADGE_CLASS, MENU_CHECK_CLASS, MENU_EMPTY_CLASS, MENU_PANEL_CLASS, menuItemClass, TRIGGER_ICON_CLASS } from './ui';

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
  filterPlaceholder,
  hideAllOption = false,
  triggerLabel,
}: {
  values: string[];
  options: SiteMultiSelectOption[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  allLabel?: string;
  maxSelections?: number;
  className?: string;
  /** 有給才顯示清單上方的篩選框 */
  filterPlaceholder?: string;
  /** 空選代表「沒有選」而不是「全部」時用 */
  hideAllOption?: boolean;
  /** 取代按鈕上的「第一項 +N」摘要；選項另外列在畫面上時用 */
  triggerLabel?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const selected = useMemo(() => new Set(values), [values]);
  const labels = options.filter((option) => selected.has(option.value)).map((option) => option.label);
  const summary = labels.length === 0 ? allLabel : labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
  const toggle = (value: string) => {
    if (selected.has(value)) onChange(values.filter((item) => item !== value));
    else if (values.length < maxSelections) onChange([...values, value]);
  };

  const keyword = filter.trim().toLowerCase();
  const visible = keyword ? options.filter((option) => option.label.toLowerCase().includes(keyword)) : options;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(fieldClass(), 'flex h-auto min-h-10 items-center justify-between gap-2 text-left', className)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate" title={labels.join('、') || allLabel}>{triggerLabel ?? summary}</span>
        <ChevronDown className={cn(TRIGGER_ICON_CLASS, 'transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="listbox"
        ariaLabel={ariaLabel}
        ariaMultiselectable
        align="start"
        className={cn(MENU_PANEL_CLASS, 'max-h-80')}
        style={{ width: 280, maxWidth: 'calc(100vw - 24px)' }}
      >
        {filterPlaceholder ? (
          <div className="sticky top-0 z-10 border-b border-border-quaternary bg-surface-popup p-2">
            <input
              type="text"
              value={filter}
              placeholder={filterPlaceholder}
              aria-label={filterPlaceholder}
              onChange={(event) => setFilter(event.target.value)}
              className={fieldClass({ size: 'sm' })}
            />
          </div>
        ) : null}
        {hideAllOption ? null : (
          <button
            type="button"
            role="option"
            aria-selected={values.length === 0}
            className={menuItemClass(values.length === 0)}
            onClick={() => onChange([])}
          >
            <span className="min-w-0 flex-1 truncate">{allLabel}</span>
            {values.length === 0 ? <Check className={MENU_CHECK_CLASS} aria-hidden /> : null}
          </button>
        )}
        {visible.map((option) => {
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
              className={menuItemClass(active)}
              onClick={() => toggle(option.value)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.badge !== undefined ? <span className={MENU_BADGE_CLASS}>{option.badge}</span> : null}
              <CheckboxIndicator checked={active} disabled={option.disabled} />
            </button>
          );
        })}
        {visible.length === 0 ? <div className={MENU_EMPTY_CLASS}>{keyword ? '沒有符合的項目' : '目前沒有來源標籤'}</div> : null}
      </AnchoredPopover>
    </>
  );
}
