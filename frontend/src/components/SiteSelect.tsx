import { ChevronDown } from 'lucide-react';
import {
  Children,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { AnchoredPopover } from '../lib/AnchoredPopover';
import { cn, fieldClass, type FieldSize, MENU_BADGE_CLASS, MENU_EMPTY_CLASS, MENU_GROUP_LABEL_CLASS, MENU_OFFSET, MENU_PANEL_CLASS, menuItemClass, PLACEHOLDER_TEXT_CLASS, TRIGGER_ICON_CLASS } from './ui';

export type SiteSelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  badge?: ReactNode;
};

export type SiteSelectGroup = { label: ReactNode; options: SiteSelectOption[] };

function optionText(label: ReactNode): string {
  return Children.toArray(label).map((child) => (typeof child === 'string' || typeof child === 'number' ? child : '')).join('');
}

function optionsFromChildren(children: ReactNode): SiteSelectOption[] {
  const result: SiteSelectOption[] = [];
  const visit = (nodes: ReactNode) => Children.forEach(nodes, (node) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(node)) return;
    if (node.type === 'option') {
      const label = node.props.children;
      result.push({ value: String(node.props.value ?? optionText(label)), label, disabled: node.props.disabled });
      return;
    }
    visit(node.props.children);
  });
  visit(children);
  return result;
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> & {
  /** 給了就用系統統一的輸入框外觀（components/ui 的 fieldClass），className 只放排版；不給＝沿用呼叫端自己的樣式（舊寫法） */
  size?: FieldSize;
  options?: SiteSelectOption[];
  groups?: SiteSelectGroup[];
  panelWidth?: number;
  placeholder?: ReactNode;
};

/** 網站共用單選：保留原生 select 的 value/onChange 介面，浮層統一由 AnchoredPopover 管理。 */
export function SiteSelect({
  children,
  options,
  groups,
  panelWidth,
  placeholder = '請選擇',
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  disabled,
  className = '',
  size,
  style,
  id,
  name,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(String(defaultValue ?? ''));
  const flatOptions = useMemo(
    () => groups?.flatMap((group) => group.options) ?? options ?? optionsFromChildren(children),
    [children, groups, options],
  );
  const selectedValue = value == null ? uncontrolledValue : String(value);
  const selected = flatOptions.find((option) => option.value === selectedValue);

  const pick = (next: string) => {
    // 跟原生 select 一樣：選到目前這一項不算變更。以前照樣送 onChange，
    // 班表精靈「重選同一個整備任務」就把已填的整備代號全清掉。
    if (next !== selectedValue) {
      if (value == null) setUncontrolledValue(next);
      const target = { value: next, name } as HTMLSelectElement;
      onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
    }
    setOpen(false);
    anchorRef.current?.focus();
  };

  return (
    <>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(size ? fieldClass({ size, fullWidth: false }) : 'min-h-8 disabled:cursor-not-allowed disabled:opacity-50', 'flex items-center justify-between gap-2 text-left', className)}
        style={style}
        onFocus={(event) => onFocus?.(event as never)}
        onBlur={(event) => onBlur?.(event as never)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && (open ? 'text-text-primary' : PLACEHOLDER_TEXT_CLASS))}>
          {selected?.label ?? (selectedValue || placeholder)}
        </span>
        <ChevronDown className={cn(TRIGGER_ICON_CLASS, 'transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="listbox"
        ariaLabel={ariaLabel || title}
        align="start"
        offset={MENU_OFFSET}
        className={MENU_PANEL_CLASS}
        style={{ width: panelWidth ?? Math.max(anchorRef.current?.getBoundingClientRect().width ?? 0, 140) }}
      >
        {(groups ?? [{ label: null, options: flatOptions }]).map((group, groupIndex) => (
          <div key={groupIndex} role="group" aria-label={typeof group.label === 'string' ? group.label : undefined}>
            {group.label ? <div className={MENU_GROUP_LABEL_CLASS}>{group.label}</div> : null}
            {group.options.map((option) => {
              const active = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  className={menuItemClass(active)}
                  onClick={() => pick(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.badge ? <span className={MENU_BADGE_CLASS}>{option.badge}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
        {flatOptions.length === 0 ? <div className={MENU_EMPTY_CLASS}>無可用選項</div> : null}
      </AnchoredPopover>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </>
  );
}
