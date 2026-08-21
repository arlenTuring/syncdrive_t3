import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const FIELD_LABEL_CLASS = 'mb-1.5 block text-xs leading-none text-zinc-400';

const MENU_PANEL_WIDTH = 160;
const menuPanelClass =
  'absolute flex max-h-[312px] flex-col items-stretch overflow-hidden rounded-lg bg-[#18181B] py-1 shadow-lg shadow-black/40';
const menuListClass =
  'flex max-h-[304px] w-full flex-col items-stretch overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]';

function menuOptionClass(active: boolean, disabled = false) {
  return [
    'flex h-10 w-full shrink-0 items-center px-3 text-left text-[14px] font-normal leading-[18px] tracking-[0.5px] transition-colors',
    disabled
      ? 'cursor-not-allowed text-[#6A7282]'
      : active
        ? 'bg-white/10 text-[#F3F4F6]'
        : 'text-[#F3F4F6] hover:bg-white/5',
  ].join(' ');
}

export type ShiftMenuOption = { value: string; label: string; disabled?: boolean };
export type ShiftMenuGroup = { label: string; options: ShiftMenuOption[] };

/** 與行動設定同風格的自訂下拉 */
export function ShiftMenuSelect({
  label,
  value,
  placeholder = '請選擇',
  options,
  groups,
  onChange,
  widthClass = 'w-[176px] shrink-0',
  panelWidth = MENU_PANEL_WIDTH,
  disabled = false,
  hideLabel = false,
  size = 'md',
  triggerClassName = '',
  'aria-label': ariaLabel,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options?: ShiftMenuOption[];
  groups?: ShiftMenuGroup[];
  onChange: (value: string) => void;
  widthClass?: string;
  panelWidth?: number;
  disabled?: boolean;
  hideLabel?: boolean;
  /** md＝行動設定預設；sm＝與路線停靠列 h-8 輸入框對齊 */
  size?: 'sm' | 'md';
  /** 覆寫 trigger 高度／字級等 */
  triggerClassName?: string;
  'aria-label'?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const isSm = size === 'sm';

  const flatOptions = useMemo(() => {
    if (groups && groups.length > 0) {
      return groups.flatMap((group) => group.options);
    }
    return options ?? [];
  }, [groups, options]);

  const displayLabel =
    flatOptions.find((item) => item.value === value)?.label
    || (value ? value : placeholder);
  const hasValue = Boolean(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${open ? 'z-50' : 'z-0'} ${widthClass}`}>
      {hideLabel ? null : <span className={FIELD_LABEL_CLASS}>{label}</span>}
      <button
        type="button"
        disabled={disabled}
        className={[
          'flex w-full items-center justify-between gap-1.5 border bg-zinc-900/80 text-left focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          isSm
            ? 'h-8 rounded-md px-2 text-xs'
            : 'h-10 rounded-lg px-3 text-sm gap-2',
          open
            ? 'border-[#7CB8FF] text-zinc-100'
            : 'border-zinc-700/80 text-zinc-100 focus:border-[#2B7FFF] focus:ring-1 focus:ring-[#2B7FFF]/30',
          triggerClassName,
        ].join(' ')}
        aria-label={ariaLabel || label || '選單'}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className={[
            'truncate tracking-[0.5px]',
            isSm ? 'text-xs leading-4' : 'text-[14px] leading-[18px]',
            hasValue ? 'text-[#F3F4F6]' : 'text-[#99A1AF]',
          ].join(' ')}
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={[
            'shrink-0 text-[#6A7282] transition-transform',
            isSm ? 'size-3' : 'size-3.5',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open ? (
        <div
          className={`${menuPanelClass} left-0 top-[calc(100%+1px)] z-50`}
          style={{ width: Math.max(panelWidth, isSm ? 112 : 140), isolation: 'isolate' }}
        >
          <div className={menuListClass}>
            {groups && groups.length > 0
              ? groups.map((group) => (
                  <div key={group.label} className="flex w-full flex-col items-stretch">
                    <div className="flex h-8 items-center px-3">
                      <span className="px-2 text-[11px] font-medium tracking-[0.5px] text-[#99A1AF]">
                        {group.label}
                      </span>
                    </div>
                    {group.options.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        disabled={item.disabled}
                        className={menuOptionClass(value === item.value, item.disabled)}
                        onClick={() => {
                          if (!item.disabled) pick(item.value);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate px-2">{item.label}</span>
                      </button>
                    ))}
                  </div>
                ))
              : (options ?? []).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    disabled={item.disabled}
                    className={menuOptionClass(value === item.value, item.disabled)}
                    onClick={() => {
                      if (!item.disabled) pick(item.value);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate px-2">{item.label}</span>
                  </button>
                ))}
            {(groups?.length ?? 0) === 0 && (options?.length ?? 0) === 0 ? (
              <div className="px-5 py-3 text-[13px] text-[#6A7282]">尚無可選項目</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
