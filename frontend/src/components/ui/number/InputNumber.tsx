import { useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import type { FieldStyle } from '../variants';

/**
 * 數字欄位（design-specs/t3-input-number-engineering-spec.md；樣式在 number.css，逐字取自規格 §6）。
 *
 * 規格 §4：編輯時保留草稿，Enter 或失焦才套用；不合法還原、Escape 取消；超出範圍收斂到 min／max；
 * 上下鍵與右側增減鈕一次 ±step；空值回傳 null（顯示 0 提示），跟 0 分開；小數精度取 min／max／step 的最大位數（最多 6 位）。
 * 增減鈕平常隱藏，滑過、聚焦或觸控裝置才顯示。
 */

function decimals(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  const text = String(n);
  const at = text.indexOf('.');
  return at < 0 ? 0 : Math.min(6, text.length - at - 1);
}

export function InputNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  fieldStyle = 'tonal-theme',
  label,
  ariaLabel,
  required = false,
  grouped = false,
  placeholder = '0',
  fluid = true,
  className,
  id,
  name,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 顯示在數字後面的單位（例如 %）；不寫進值 */
  unit?: ReactNode;
  disabled?: boolean;
  fieldStyle?: FieldStyle;
  label?: ReactNode;
  ariaLabel?: string;
  required?: boolean;
  /** 失焦時顯示千分位 */
  grouped?: boolean;
  placeholder?: string;
  /** 寬度填滿父層（預設）；false＝規格樣本寬 240 */
  fluid?: boolean;
  className?: string;
  id?: string;
  name?: string;
}) {
  const precision = Math.max(decimals(min), decimals(max), decimals(step));
  const factor = 10 ** precision;
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(n * factor) / factor));
  const format = (n: number | null, editing: boolean) =>
    n == null ? '' : grouped && !editing ? n.toLocaleString('en-US', { maximumFractionDigits: precision }) : String(n);

  const [draft, setDraft] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [handlerState, setHandlerState] = useState<string | null>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const autoId = useId();
  const inputId = id ?? autoId;
  const shown = draft ?? format(value, false);

  const commit = () => {
    if (draft == null) return;
    const raw = draft.trim().replace(/,/g, '');
    setDraft(null);
    if (raw === '') {
      if (value !== null) onChange(null);
      return;
    }
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(raw)) return; // 不合法：還原成上次套用值
    const next = clamp(Number(raw));
    if (next !== value) onChange(next);
  };
  const stepBy = (direction: 1 | -1) => {
    if (disabled) return;
    const base = draft != null && /^-?(\d+\.?\d*|\.\d+)$/.test(draft.trim().replace(/,/g, '')) ? Number(draft.replace(/,/g, '')) : value ?? 0;
    const next = clamp((Math.round(base * factor) + direction * Math.round(step * factor)) / factor);
    setDraft(null);
    if (next !== value) onChange(next);
  };
  const atMax = max != null && value != null && value >= max;
  const atMin = min != null && value != null && value <= min;
  const state = disabled ? 'disabled' : hover ? 'hover' : 'default';

  return (
    <div
      className={cn('t3-number', className)}
      data-style={fieldStyle}
      data-state={state}
      data-fluid={fluid ? 'true' : undefined}
      data-focus-origin={pointerFocus ? 'pointer' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setHandlerState(null); }}
      onPointerDown={() => setPointerFocus(true)}
      onKeyDown={() => setPointerFocus(false)}
    >
      {label != null ? (
        <label id={labelId} htmlFor={inputId} className="t3-number__label">
          {required ? <b aria-hidden>*</b> : null}
          {label}
        </label>
      ) : null}
      <div className="t3-number__box" onClick={() => input.current?.focus()}>
        <span className="t3-number__content">
          <span className="t3-number__editor">
            <span className="t3-number__measure" aria-hidden>{shown || placeholder}</span>
            <input
              ref={input}
              id={inputId}
              name={name}
              className="t3-number__input"
              role="spinbutton"
              inputMode="decimal"
              aria-label={label == null ? ariaLabel : undefined}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value ?? undefined}
              aria-valuetext={value != null && unit != null && typeof unit === 'string' ? `${value}${unit}` : undefined}
              required={required}
              disabled={disabled}
              placeholder={placeholder}
              value={shown}
              onFocus={() => setDraft(format(value, true))}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') commit();
                else if (event.key === 'Escape') setDraft(null);
                else if (event.key === 'ArrowUp') { event.preventDefault(); stepBy(1); }
                else if (event.key === 'ArrowDown') { event.preventDefault(); stepBy(-1); }
              }}
            />
          </span>
          {unit != null ? <span className="t3-number__unit">{unit}</span> : null}
        </span>
        <span className="t3-handler" data-style={fieldStyle} data-state={disabled ? 'disabled' : handlerState ?? 'default'}>
          {([['up', 1, '增加數值', atMax], ['down', -1, '減少數值', atMin]] as const).map(([direction, delta, name2, edge]) => (
            <button
              key={direction}
              type="button"
              className="t3-handler__button"
              data-direction={direction}
              aria-label={name2}
              disabled={disabled || edge}
              onMouseEnter={() => setHandlerState(`${direction}-hover`)}
              onMouseLeave={() => setHandlerState(null)}
              onMouseDown={(event) => { event.preventDefault(); setHandlerState(`${direction}-pressed`); }}
              onMouseUp={() => setHandlerState(`${direction}-hover`)}
              onClick={(event) => { event.stopPropagation(); stepBy(delta); }}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d={direction === 'up' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
