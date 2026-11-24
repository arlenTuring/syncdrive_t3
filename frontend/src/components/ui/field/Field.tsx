import { AlertCircle, Eye, EyeOff, Search, XCircle } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../cn';
import { ERROR_TEXT_CLASS, fieldClass, HINT_CLASS, LABEL_CLASS, type FieldSize, type FieldStyle } from '../variants';

/**
 * 輸入欄位（design-specs/t3-text-field-engineering-spec.md；樣式在 field.css）。
 *
 * - TextInput 不帶配件時就是單獨一顆輸入框（.t3-input），排版交給呼叫端（className 只放排版）。
 * - 帶 leading（搜尋圖示）、unit（單位）、clearable（清除鈕）、password 切換時，照規格包成 .t3-field 結構。
 * - TextArea 照規格依內容自動長高、不出捲軸（autoGrow=false 可關掉，改成可手動拉高）。
 */

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'style'> & {
  size?: FieldSize;
  invalid?: boolean;
  /** 欄位 Style；預設 tonal-theme */
  fieldStyle?: FieldStyle;
  /** 左側圖示；true＝搜尋圖示 */
  leading?: ReactNode | true;
  /** 右側單位文字（例如 %）；不寫進值 */
  unit?: ReactNode;
  /** 有內容時顯示清除鈕（清空並保留焦點）；需要配合 onChange 讓外部更新值 */
  clearable?: boolean;
  /** 密碼欄位：右側顯示／隱藏切換（type 自動在 password／text 之間切換） */
  password?: boolean;
};

function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', invalid = false, fieldStyle = 'tonal-theme', leading, unit, clearable = false, password = false, className, type, disabled, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const [hasValue, setHasValue] = useState(Boolean(rest.value ?? rest.defaultValue));
  const setRef = useCallback((node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  const decorated = leading != null || unit != null || clearable || password;
  if (!decorated) {
    return (
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(fieldClass({ size, invalid, style: fieldStyle }), className)}
        {...rest}
      />
    );
  }
  const value = rest.value != null ? String(rest.value) : null;
  const filled = value != null ? value.length > 0 : hasValue;
  const state = disabled ? 'disabled' : invalid ? (focused ? 'error-focus' : 'error') : focused ? 'focus' : filled ? 'active' : 'default';
  return (
    <div className={cn('t3-field', className)} data-kind="text" data-style={fieldStyle} data-state={state} data-fluid="true">
      <div className="t3-field__box">
        {leading != null ? <span className="t3-field__leading">{leading === true ? <Search aria-hidden /> : leading}</span> : null}
        <input
          ref={setRef}
          className="t3-field__input"
          type={password ? (shown ? 'text' : 'password') : type}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          {...rest}
          onFocus={(event) => { setFocused(true); rest.onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
          onChange={(event) => { setHasValue(event.target.value.length > 0); rest.onChange?.(event); }}
        />
        {unit != null ? <span className="t3-field__unit">{unit}</span> : null}
        {password ? (
          <button type="button" className="t3-field__action" disabled={disabled} aria-label={shown ? '隱藏密碼' : '顯示密碼'} onClick={() => setShown((v) => !v)}>
            {shown ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          </button>
        ) : null}
        {state === 'error' ? (
          <span className="t3-field__action t3-field__error" aria-hidden><AlertCircle /></span>
        ) : clearable && filled && !disabled ? (
          <button
            type="button"
            className="t3-field__action"
            aria-label="清除"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!inner.current) return;
              setNativeValue(inner.current, '');
              setHasValue(false);
              inner.current.focus();
            }}
          >
            <XCircle aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
});

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  invalid?: boolean;
  fieldStyle?: FieldStyle;
  /** 依內容自動長高、不出捲軸（規格行為）；預設開 */
  autoGrow?: boolean;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid = false, fieldStyle = 'tonal-theme', autoGrow = true, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const grow = useCallback(() => {
    const node = inner.current;
    if (!node || !autoGrow) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [autoGrow]);
  useLayoutEffect(grow, [grow, rest.value]);
  return (
    <textarea
      ref={(node) => {
        inner.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      aria-invalid={invalid || undefined}
      data-autogrow={autoGrow ? 'true' : undefined}
      className={cn(fieldClass({ invalid, multiline: true, style: fieldStyle }), className)}
      {...rest}
      onInput={(event) => { grow(); rest.onInput?.(event); }}
    />
  );
});

/**
 * 欄位外框：標題＋輸入元件＋輔助文字／錯誤訊息（規格：標題 18 高、距欄位 4px；輔助文字上下 4 左右 12）。
 * children 是函式時會拿到 id，交給輸入元件讓標題點得到它。
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col', className)}>
      <label htmlFor={id} className={cn(LABEL_CLASS, 'mb-1')}>
        {required ? <span className="text-status-error-emphasis">*</span> : null}
        {label}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <p className={ERROR_TEXT_CLASS}>{error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}
    </div>
  );
}

export type SelectFieldConfig =
  | 'text'
  | 'color'
  | 'input-chip'
  | 'toggle'
  | 'checkbox-list'
  | 'radio'
  | 'checkbox-column'
  | 'radio-column'
  | 'empty';

/**
 * SelectField：標題＋一個放選項的插槽（規格 §5 的 9 種組合）。勾選、單選、開關、Chip 用 components/ui 的元件放進來。
 */
export function SelectField({
  label,
  required = false,
  config = 'empty',
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  config?: SelectFieldConfig;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn('t3-select', className)} data-config={config} data-fluid="true">
      <legend>
        {required ? <b>*</b> : null}
        {label}
      </legend>
      <div className="t3-select__slot">{children}</div>
    </fieldset>
  );
}
