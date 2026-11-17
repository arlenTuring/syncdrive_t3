import { forwardRef, useCallback, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

/**
 * T3 UI Kit Checkbox（設計文件：frontend/design-specs/t3-checkbox-engineering-spec.md；樣式：checkbox.css）。
 *
 * 結構照文件 §5：外層 span.t3-checkbox[data-size][data-style][data-select] ＞ 透明的原生 input ＋ 裝飾內框。
 * 外觀全部由 CSS 依原生 input 狀態（hover、active、disabled）決定；這裡只同步 checked／indeterminate。
 * 停用時一律輸出 data-style="basic"（Figma 沒有 Error／Disabled，文件規定用 Basic／Disabled 外觀）。
 */

export type CheckboxSize = 'medium' | 'small';
export type CheckboxVariant = 'basic' | 'error';
/** true＝勾選、false＝未勾選、'mixed'＝部分勾選（表頭全選） */
export type CheckboxChecked = boolean | 'mixed';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'checked' | 'defaultChecked' | 'onChange' | 'children'> & {
  checked: CheckboxChecked;
  /** 原生 change 觸發一次；從 mixed 啟用時送 true */
  onCheckedChange?: (checked: boolean) => void;
  /** 預設 medium（操作區都是 24×24） */
  size?: CheckboxSize;
  /** 預設 basic；error 會輸出 aria-invalid */
  variant?: CheckboxVariant;
  /** 可見標籤；沒有可見文字時改給 aria-label */
  label?: ReactNode;
  /** 標籤的排版 class（字色、間距由畫面決定；預設 text-body-s-bold text-text-primary） */
  labelClassName?: string;
  /** 外層排版 class */
  className?: string;
};

const TICK_PATH = 'M3.64425 8.6885 0 5.04425 1.04425 4 3.64425 6.6 10.24425 0 11.2885 1.04425Z';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, size = 'medium', variant = 'basic', label, labelClassName, className, id, disabled = false, ...rest },
  forwarded,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inner = useRef<HTMLInputElement | null>(null);
  const select = checked === 'mixed' ? 'mixed' : checked ? 'checked' : 'unchecked';

  // indeterminate 只能用 DOM 屬性設定；外部資料變動時同步（文件 §3）
  useLayoutEffect(() => {
    if (inner.current) inner.current.indeterminate = select === 'mixed';
  }, [select]);

  const setRef = useCallback((node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof forwarded === 'function') forwarded(node);
    else if (forwarded) forwarded.current = node;
  }, [forwarded]);

  const control = (
    <span className="t3-checkbox" data-size={size} data-style={disabled ? 'basic' : variant} data-select={select}>
      <input
        ref={setRef}
        id={inputId}
        className="t3-checkbox__input"
        type="checkbox"
        checked={select === 'checked'}
        disabled={disabled}
        aria-invalid={variant === 'error' ? true : undefined}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        {...rest}
      />
      <span className="t3-checkbox__box" aria-hidden="true">
        <svg className="t3-checkbox__tick" viewBox="0 0 24 24" focusable="false" fill="currentColor">
          <path transform="translate(6.35575 7.35575)" d={TICK_PATH} />
        </svg>
        <span className="t3-checkbox__mixed" />
      </span>
    </span>
  );

  if (label === undefined || label === null) {
    return className ? <span className={cn('inline-flex', className)}>{control}</span> : control;
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {control}
      <label htmlFor={inputId} className={cn('cursor-pointer select-none', labelClassName ?? 'text-body-s-bold text-text-primary', disabled && 'cursor-default text-text-disabled')}>
        {label}
      </label>
    </span>
  );
});

/**
 * 只有外觀的勾選框（沒有 input）：放在已經是可操作元素裡的清單項目，例如下拉多選的選項
 * （role="option" 的按鈕裡不能再放 input）。狀態由外層元素的 aria-selected 等屬性表達。
 * 只呈現 Default 外觀；Hover／Pressed 由外層元素自己處理。
 */
export function CheckboxIndicator({ checked, size = 'small', disabled = false }: { checked: CheckboxChecked; size?: CheckboxSize; disabled?: boolean }) {
  const select = checked === 'mixed' ? 'mixed' : checked ? 'checked' : 'unchecked';
  return (
    <span className="t3-checkbox" data-size={size} data-style="basic" data-select={select} data-preview-state={disabled ? 'disabled' : 'default'} aria-hidden="true">
      <span className="t3-checkbox__box">
        <svg className="t3-checkbox__tick" viewBox="0 0 24 24" focusable="false" fill="currentColor">
          <path transform="translate(6.35575 7.35575)" d={TICK_PATH} />
        </svg>
        <span className="t3-checkbox__mixed" />
      </span>
    </span>
  );
}
