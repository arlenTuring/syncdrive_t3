import { Check, ChevronDown } from 'lucide-react';
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
    if (value == null) setUncontrolledValue(next);
    const target = { value: next, name } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
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
        className={`flex min-h-8 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
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
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-zinc-500'}`}>
          {selected?.label ?? (selectedValue || placeholder)}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="listbox"
        ariaLabel={ariaLabel || title}
        align="start"
        className="max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-[#18181b] py-1 shadow-xl shadow-black/50 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
        style={{ width: panelWidth ?? Math.max(anchorRef.current?.getBoundingClientRect().width ?? 0, 140) }}
      >
        {(groups ?? [{ label: null, options: flatOptions }]).map((group, groupIndex) => (
          <div key={groupIndex} role="group" aria-label={typeof group.label === 'string' ? group.label : undefined}>
            {group.label ? <div className="px-3 py-2 text-xs font-medium text-zinc-500">{group.label}</div> : null}
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
                  className={`flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:text-zinc-600 ${active ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-100 hover:bg-white/5'}`}
                  onClick={() => pick(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.badge ? <span className="shrink-0 text-xs text-zinc-500">{option.badge}</span> : null}
                  {active ? <Check className="size-4 shrink-0 text-sky-400" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        ))}
        {flatOptions.length === 0 ? <div className="px-3 py-2 text-sm text-zinc-500">無可用選項</div> : null}
      </AnchoredPopover>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </>
  );
}
