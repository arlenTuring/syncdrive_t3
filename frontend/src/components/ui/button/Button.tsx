import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { buttonAttributes, type ButtonHierarchy, type ButtonStyle, type IconButtonSize, type IconButtonStyle } from '../variants';

export type { ButtonHierarchy, ButtonStyle, IconButtonSize, IconButtonStyle };

/**
 * T3 UI Kit 按鈕。樣式在 button.css（逐字取自設計交付的工程文件），這裡只輸出接線屬性：
 *   Button      class="t3-button text-body-s-bold" data-hierarchy data-style
 *   IconButton  class="t3-icon-button"             data-size data-hierarchy data-style [aria-pressed]
 *
 * 配色只能從 hierarchy × variant 選；className 只用來排版（margin、寬度、flex），不要覆蓋顏色。
 * 規格：frontend/design-specs/t3-text-button-engineering-spec.md、t3-icon-button-engineering-spec.md
 */

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'style'>;

export type ButtonProps = NativeButton & {
  /** 預設 superior */
  hierarchy?: ButtonHierarchy;
  /** 預設 filled */
  variant?: ButtonStyle;
  /** 標籤文字（也可以用 children） */
  label?: ReactNode;
  children?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** 撐滿父層寬度（排版用） */
  block?: boolean;
  /** 啟用時觸發一次（等同 onClick；停用時不會觸發） */
  onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
};

function Slot({ className, children }: { className: string; children: ReactNode }) {
  return <span className={className} aria-hidden="true">{children}</span>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { hierarchy = 'superior', variant = 'filled', label, children, leadingIcon, trailingIcon, block = false, onPress, onClick, className, type = 'button', ...rest },
  ref,
) {
  const attrs = buttonAttributes(hierarchy, variant);
  return (
    <button
      ref={ref}
      type={type}
      data-hierarchy={attrs['data-hierarchy']}
      data-style={attrs['data-style']}
      className={cn(attrs.className, block && 'w-full', className)}
      onClick={(event) => {
        onClick?.(event);
        onPress?.(event);
      }}
      {...rest}
    >
      {leadingIcon ? <Slot className="t3-button__icon">{leadingIcon}</Slot> : null}
      {label ?? children}
      {trailingIcon ? <Slot className="t3-button__icon">{trailingIcon}</Slot> : null}
    </button>
  );
});

export type IconButtonProps = NativeButton & {
  /** 必填可及名稱（螢幕閱讀器、滑鼠提示），例如「重新整理」 */
  label: string;
  /** 必填圖示（單色 SVG，顏色跟著狀態走 currentColor） */
  icon: ReactNode;
  /** 預設 medium（外框都是 34×34，圖示 24 或 18） */
  size?: IconButtonSize;
  /** 預設 superior */
  hierarchy?: ButtonHierarchy;
  /** 預設 filled */
  variant?: IconButtonStyle;
  /** 可切換的按鈕才給：由呼叫端保存，輸出 aria-pressed；單次操作不要給 */
  pressed?: boolean;
  onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'medium', hierarchy = 'superior', variant = 'filled', pressed, onPress, onClick, className, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={title ?? label}
      data-size={size}
      data-hierarchy={hierarchy}
      data-style={variant}
      className={cn('t3-icon-button', className)}
      onClick={(event) => {
        onClick?.(event);
        onPress?.(event);
      }}
      {...rest}
    >
      <Slot className="t3-icon-button__icon">{icon}</Slot>
    </button>
  );
});
