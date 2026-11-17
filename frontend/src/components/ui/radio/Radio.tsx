import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

/**
 * T3 UI Kit Radio Basic（設計文件：frontend/design-specs/t3-radio-engineering-spec.md；樣式：radio.css）。
 *
 * 結構照文件 §5：label.t3-radio-option ＞ span.t3-radio[data-size] ＞ 透明的原生 input ＋ 內圈與圓點。
 * 同一組共用 name；方向鍵切換、Space 選取、停用跳過，都交給原生 radio。
 * 一組選項請用 RadioGroup（fieldset＋legend 命名群組）。
 */

export type RadioSize = 'medium' | 'small';

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'children'> & {
  /** 可見標籤；沒有可見文字時改給 aria-label */
  label?: ReactNode;
  /** 預設 medium（操作區都是 24×24） */
  size?: RadioSize;
  /** 外層 label 的排版 class */
  className?: string;
};

export function Radio({ label, size = 'medium', className, ...rest }: RadioProps) {
  const control = (
    <span className="t3-radio" data-size={size}>
      <input className="t3-radio__input" type="radio" {...rest} />
      <span className="t3-radio__ring" aria-hidden="true"><span className="t3-radio__dot" /></span>
    </span>
  );
  if (label === undefined || label === null) return control;
  return (
    <label className={cn('t3-radio-option text-body-s-bold', rest.disabled && 'text-text-disabled', className)}>
      {control}
      {label}
    </label>
  );
}

export type RadioOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

/** 一組 Radio：value 由頁面保存，選另一項時 onValueChange 送出新值 */
export function RadioGroup<T extends string>({
  legend,
  hideLegend = false,
  name,
  value,
  onValueChange,
  options,
  size = 'medium',
  disabled = false,
  orientation = 'horizontal',
  className,
}: {
  /** 群組名稱（螢幕閱讀器會念）；畫面上不想顯示可設 hideLegend */
  legend: ReactNode;
  hideLegend?: boolean;
  name?: string;
  value: T | null;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<RadioOption<T>>;
  size?: RadioSize;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const autoName = useId();
  const groupName = name ?? autoName;
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)} disabled={disabled}>
      <legend className={hideLegend ? 'sr-only' : 'mb-1 text-caption-1 text-text-secondary'}>{legend}</legend>
      <div className={cn('flex', orientation === 'horizontal' ? 'flex-wrap items-center gap-x-4' : 'flex-col items-start')}>
        {options.map((option) => (
          <Radio
            key={option.value}
            name={groupName}
            value={option.value}
            size={size}
            label={option.label}
            checked={value === option.value}
            disabled={disabled || option.disabled}
            onChange={(event) => {
              if (event.currentTarget.checked) onValueChange(option.value);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
