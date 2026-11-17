import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';

/**
 * T3 UI Kit Switch（設計文件：frontend/design-specs/t3-switch-engineering-spec.md；樣式：switch.css）。
 *
 * 文件的正式範例是 Ant Design Vue；本專案是 React，採文件 §5 的原生範例：
 * span.t3-switch[data-configuration] ＞ 透明的 input[type=checkbox][role=switch]（覆蓋整個軌道，可點擊區含
 * 滑塊、文字與留白）＋ 裝飾軌道。外觀與 200ms 動畫全由 CSS 依 :checked／:active／:disabled 決定。
 */

export type SwitchConfiguration = 'basic' | 'with-text';

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'checked' | 'defaultChecked' | 'onChange' | 'children'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** with-text 時顯示在軌道裡的文字，也當作可及名稱（切換前後不變） */
  text?: string;
  /** 有給 text 預設 with-text，否則 basic */
  configuration?: SwitchConfiguration;
  /** basic 沒有可見文字時必填：可及名稱 */
  'aria-label'?: string;
  /** 外層排版 class */
  className?: string;
};

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, text, configuration, className, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const config: SwitchConfiguration = configuration ?? (text ? 'with-text' : 'basic');
  return (
    <span className={cn('t3-switch', className)} data-configuration={config}>
      <input
        ref={ref}
        className="t3-switch__input"
        type="checkbox"
        role="switch"
        aria-label={ariaLabel ?? text}
        checked={checked}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        {...rest}
      />
      <span className="t3-switch__track" aria-hidden="true">
        <span className="t3-switch__thumb" />
        {config === 'with-text' ? <span className="t3-switch__label text-body-xs">{text}</span> : null}
      </span>
    </span>
  );
});
