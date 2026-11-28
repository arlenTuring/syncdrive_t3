import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../cn';

/**
 * T3 UI Kit Slider（設計文件：frontend/design-specs/t3-slider-engineering-spec.md；樣式：slider.css）。
 *
 * 規格以 Ant Design Vue Slider 為互動基底；本專案是 React，不引入 Ant Design，自己做同樣的互動：
 * - 拖曳端點或點軌道改值；Range 兩端各自操作，永遠 lower ≤ upper。
 * - 聚焦後方向鍵逐步調整、PageUp／PageDown 跳十步、Home／End 到兩端。
 * - 只有 Default／Pressed／Disabled 三種外觀；Pressed 只在拖曳或按住按鍵時出現在正在操作的端點，
 *   放開就恢復（聚焦本身不改外觀、不顯示外框）。
 * - Discrete 依 step 畫刻度（dot／line），Continuous 不畫。
 *
 * 一般數值標籤在端點上方 4px、Pressed 時換成水滴氣泡；兩者都超出 24px 元件本體，
 * 父容器要留上方空間、不可 overflow: hidden 裁切。不要數值時給 showLabel={false}（例如工具列）。
 */

export type SliderVariant = 'discrete' | 'continuous';
export type SliderThumbStyle = 'filled' | 'icon';
export type SliderTickStyle = 'dot' | 'line';

type CommonProps = {
  min?: number;
  max?: number;
  step?: number;
  /** discrete：顯示刻度；continuous：不顯示。預設 continuous */
  variant?: SliderVariant;
  disabled?: boolean;
  /** Basic 可用 filled／icon；Range 只有 filled */
  thumbStyle?: SliderThumbStyle;
  tickStyle?: SliderTickStyle;
  /** 數值標籤（LabelText）。預設顯示 */
  showLabel?: boolean;
  /** 標籤上的文字；預設就是數值 */
  formatLabel?: (value: number) => ReactNode;
  /** 可及名稱（沒有可見標題時必填） */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** 讀屏念的數值文字；預設是數值 */
  getAriaValueText?: (value: number) => string;
  /** 外層排版 class（寬度等）；不要用來改顏色或尺寸 */
  className?: string;
};

export type SliderProps = CommonProps & (
  | {
    range?: false;
    value: number;
    onChange: (value: number) => void;
    /** 一次操作結束（放開滑鼠、觸控或按鍵）時通知 */
    onChangeEnd?: (value: number) => void;
  }
  | {
    range: true;
    value: [number, number];
    onChange: (value: [number, number]) => void;
    onChangeEnd?: (value: [number, number]) => void;
  }
);

/** Discrete 刻度太密時不畫（畫不清楚，也拖慢頁面） */
const MAX_TICKS = 101;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 對齊合法步距，並去掉浮點尾數（0.1 + 0.2） */
function snap(value: number, min: number, max: number, step: number): number {
  if (!(step > 0)) return clamp(value, min, max);
  const steps = Math.round((value - min) / step);
  const decimals = (String(step).split('.')[1] ?? '').length;
  return clamp(Number((min + steps * step).toFixed(Math.min(10, decimals + 2))), min, max);
}

export function Slider(props: SliderProps) {
  const {
    min = 0,
    max = 100,
    step = 1,
    variant = 'continuous',
    disabled = false,
    thumbStyle = 'filled',
    tickStyle = 'dot',
    showLabel = true,
    formatLabel,
    getAriaValueText,
    className,
  } = props;
  const values: number[] = props.range ? [props.value[0], props.value[1]] : [props.value];
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActiveState] = useState<number | null>(null);
  // 放開時 pointerup 與 lostpointercapture 都會來：用 ref 判斷，一次操作只通知一次 onChangeEnd
  const activeRef = useRef<number | null>(null);
  const setActive = (index: number | null) => {
    activeRef.current = index;
    setActiveState(index);
  };
  const latest = useRef(values);
  latest.current = values;

  const span = max - min;
  const percent = (value: number) => (span > 0 ? ((clamp(value, min, max) - min) / span) * 100 : 0);

  const emit = useCallback((next: number[]) => {
    latest.current = next;
    if (props.range) props.onChange([next[0]!, next[1]!]);
    else props.onChange(next[0]!);
  }, [props]);

  const emitEnd = useCallback(() => {
    const final = latest.current;
    if (props.range) props.onChangeEnd?.([final[0]!, final[1]!]);
    else props.onChangeEnd?.(final[0]!);
  }, [props]);

  const setAt = (index: number, raw: number) => {
    let next = snap(raw, min, max, step);
    const current = latest.current;
    if (props.range) {
      // lower ≤ upper：拖過另一端時停在另一端
      next = index === 0 ? Math.min(next, current[1]!) : Math.max(next, current[0]!);
    }
    if (next === current[index]) return;
    const updated = [...current];
    updated[index] = next;
    emit(updated);
  };

  const valueFromPointer = (clientX: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return min;
    return min + ((clientX - rect.left) / rect.width) * span;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const raw = valueFromPointer(event.clientX);
    const current = latest.current;
    // 點軌道：移動離得近的那一端（兩端重疊時，往右點動右端、往左點動左端）
    const index = props.range
      ? (Math.abs(raw - current[0]!) < Math.abs(raw - current[1]!)
        || (current[0] === current[1] && raw < current[0]!) ? 0 : 1)
      : 0;
    setActive(index);
    setAt(index, raw);
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = event.currentTarget.querySelectorAll<HTMLElement>('[role="slider"]')[index];
    handle?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const index = activeRef.current;
    if (index == null || disabled) return;
    setAt(index, valueFromPointer(event.clientX));
  };

  const endPress = () => {
    if (activeRef.current == null) return;
    setActive(null);
    emitEnd();
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = latest.current[index]!;
    const bigStep = Math.max(step, span / 10);
    const targets: Record<string, number> = {
      ArrowRight: current + step,
      ArrowUp: current + step,
      ArrowLeft: current - step,
      ArrowDown: current - step,
      PageUp: current + bigStep,
      PageDown: current - bigStep,
      Home: min,
      End: max,
    };
    const target = targets[event.key];
    if (target == null) return;
    event.preventDefault();
    setActive(index);
    setAt(index, target);
  };

  const onKeyUp = () => endPress();

  const ticks: number[] = [];
  if (variant === 'discrete' && step > 0 && span > 0 && span / step + 1 <= MAX_TICKS) {
    for (let at = min; at <= max + step / 1e6; at += step) ticks.push(Math.min(max, at));
  }
  const [low, high] = props.range ? [values[0]!, values[1]!] : [min, values[0]!];

  return (
    <div
      className={cn('t3-slider', props.range && 'is-range', disabled && 'is-disabled', active != null && 'is-pressed', className)}
      data-tick={tickStyle}
      data-thumb={props.range ? 'filled' : thumbStyle}
      aria-disabled={disabled || undefined}
    >
      <div
        ref={bodyRef}
        className="t3-slider__body"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onLostPointerCapture={endPress}
      >
        <div className="t3-slider__rail" />
        <div className="t3-slider__track" style={{ left: `${percent(low)}%`, width: `${percent(high) - percent(low)}%` }} />
        {ticks.map((tick) => (
          <span
            key={tick}
            className="t3-slider__dot"
            data-active={tick >= low && tick <= high ? 'true' : undefined}
            style={{ left: `${percent(tick)}%` }}
          />
        ))}
        {values.map((value, index) => (
          <div
            key={index}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            className="t3-slider__handle"
            data-active={active === index ? 'true' : undefined}
            style={{ left: `${percent(value)}%`, zIndex: active === index ? 2 : 1 }}
            aria-valuemin={props.range && index === 1 ? values[0] : min}
            aria-valuemax={props.range && index === 0 ? values[1] : max}
            aria-valuenow={value}
            aria-valuetext={getAriaValueText?.(value)}
            aria-orientation="horizontal"
            aria-disabled={disabled || undefined}
            aria-label={props.range ? `${props['aria-label'] ?? ''}${index === 0 ? '（下限）' : '（上限）'}` : props['aria-label']}
            aria-labelledby={props['aria-labelledby']}
            onKeyDown={onKeyDown(index)}
            onKeyUp={onKeyUp}
            onBlur={() => { if (activeRef.current === index) endPress(); }}
          >
            {showLabel ? (
              <span className="t3-slider__label text-body-xs" data-bubble={active === index && !disabled ? 'true' : undefined}>
                {formatLabel ? formatLabel(value) : value}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
