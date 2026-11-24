import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import type { FieldStyle } from '../variants';

/**
 * 下拉（design-specs/t3-dropdown-engineering-spec.md；樣式在 dropdown.css，逐字取自規格 §6）。
 *
 * - 單選：選了就回填並關閉。多選（multiple）：選單維持展開，欄位即時顯示 Chip，Chip 的 × 只移除那一個值。
 * - textOnly：Text-Dropdown（工具列上的文字下拉），hierarchy 為 subordinate／superior。
 * - Escape、點外面、焦點移出元件時關閉；上下鍵移動選項，Home／End 到頭尾。
 * 一般表單的單選下拉仍可用 SiteSelect（觸發鈕同一組欄位色票，選單同一組規格）。
 */

export type DropdownOption<T extends string = string> = { value: T; label: ReactNode; disabled?: boolean };

type Common<T extends string> = {
  options: ReadonlyArray<DropdownOption<T>>;
  label?: ReactNode;
  /** 隱藏標題時仍要給可存取名稱 */
  ariaLabel?: string;
  required?: boolean;
  help?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  fieldStyle?: FieldStyle;
  textOnly?: boolean;
  hierarchy?: 'subordinate' | 'superior';
  className?: string;
};

export type DropdownProps<T extends string = string> = Common<T> & (
  | { multiple?: false; value: T | null; onChange: (value: T | null) => void }
  | { multiple: true; value: readonly T[]; onChange: (value: T[]) => void }
);

export function Dropdown<T extends string = string>(props: DropdownProps<T>) {
  const {
    options, label, ariaLabel, required = false, help, placeholder = '請選擇', disabled = false,
    fieldStyle = 'tonal-theme', textOnly = false, hierarchy = 'subordinate', className,
  } = props;
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const menuId = useId();
  const selected: readonly T[] = props.multiple ? props.value : props.value == null ? [] : [props.value];
  const hasValue = selected.length > 0;
  const state = disabled ? 'disabled' : open ? 'focus' : textOnly && hover ? 'hover' : hasValue ? 'active' : 'default';

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!event.composedPath().includes(root.current as EventTarget)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // 規格的自繪捲軸：滑塊高度依可見比例、位置隨捲動更新
  const syncThumb = () => {
    const node = list.current;
    const bar = thumb.current;
    if (!node || !bar) return;
    const ratio = node.clientHeight / Math.max(1, node.scrollHeight);
    bar.parentElement!.hidden = ratio >= 1;
    const height = Math.max(24, node.clientHeight * ratio);
    bar.style.height = `${height}px`;
    bar.style.top = `${(node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight)) * (node.clientHeight - height)}px`;
  };
  useEffect(() => {
    if (open) syncThumb();
  });

  const pick = (value: T) => {
    if (props.multiple) {
      const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
      props.onChange(next as T[]);
    } else {
      props.onChange(value);
      setOpen(false);
      trigger.current?.focus();
    }
  };
  const remove = (value: T) => {
    if (disabled || !props.multiple) return;
    props.onChange(selected.filter((v) => v !== value) as T[]);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus();
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(enabled.length - 1);
    else if (event.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
    } else return;
    event.preventDefault();
  };
  const labelOf = (value: T) => options.find((option) => option.value === value)?.label ?? value;

  return (
    <div
      ref={root}
      className={cn('t3-dropdown', className)}
      data-style={fieldStyle}
      data-state={state}
      data-multiple={props.multiple ? 'true' : 'false'}
      data-has-value={hasValue ? 'true' : 'false'}
      data-kind={textOnly ? 'text' : undefined}
      data-hierarchy={textOnly ? hierarchy : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {label != null && !textOnly ? (
        <span id={labelId} className="t3-dropdown__label">
          {required ? <span className="t3-dropdown__required">*</span> : null}
          {label}
        </span>
      ) : null}
      <div className="t3-dropdown__field">
        <button
          ref={trigger}
          type="button"
          className="t3-dropdown__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-labelledby={label != null && !textOnly ? labelId : undefined}
          aria-label={label == null || textOnly ? ariaLabel : undefined}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() => items.current.find((item) => item && !item.disabled)?.focus());
            }
          }}
        />
        <span className="t3-dropdown__value" data-placeholder={hasValue ? 'false' : 'true'}>
          {props.multiple && hasValue ? (
            <span className="t3-dropdown__chips">
              {selected.map((value) => (
                <span key={value} className="t3-dropdown__chip">
                  <span className="t3-dropdown__chip-text">{labelOf(value)}</span>
                  <button type="button" className="t3-dropdown__remove" aria-label="移除" disabled={disabled} onClick={() => remove(value)}>
                    <X size={18} aria-hidden />
                  </button>
                </span>
              ))}
            </span>
          ) : (
            <span className="t3-dropdown__single">{hasValue ? labelOf(selected[0]!) : placeholder}</span>
          )}
        </span>
        <ChevronDown className="t3-dropdown__arrow" size={20} aria-hidden style={{ transform: open && !textOnly ? 'rotate(180deg)' : undefined }} />
      </div>
      {open ? (
        <div className="t3-dropdown__menu">
          <div ref={list} id={menuId} role="listbox" aria-multiselectable={props.multiple || undefined} className="t3-dropdown__list" onScroll={syncThumb} onKeyDown={onMenuKey}>
            {options.map((option, index) => (
              <button
                key={option.value}
                ref={(node) => { items.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={selected.includes(option.value)}
                className="t3-dropdown__option"
                disabled={option.disabled}
                onClick={() => pick(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="t3-dropdown__scroller" aria-hidden><span ref={thumb} className="t3-dropdown__scrollbar" /></span>
        </div>
      ) : null}
      {help != null && !textOnly ? <p className="t3-dropdown__help">{help}</p> : null}
    </div>
  );
}
