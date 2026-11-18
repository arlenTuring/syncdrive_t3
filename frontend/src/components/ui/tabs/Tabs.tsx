import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * 頁籤與分段切換（專案自訂，設計稿尚未提供規格；規格到了只改這裡）。
 *
 * - Tabs：頁面上方的分頁（底線樣式），切換整塊內容。
 * - SegmentedControl：一小組互斥選項（例如「1 小時／6 小時／24 小時」），切換同一塊內容的條件。
 */

export type TabItem<T extends string> = { id: T; label: ReactNode; disabled?: boolean };

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** 頁籤群組的可及名稱 */
  label?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex items-end gap-1', className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative whitespace-nowrap px-4 py-2.5 transition-colors disabled:cursor-not-allowed disabled:text-text-disabled',
              active ? 'text-body-s-bold text-text-theme' : 'text-body-s text-text-tertiary hover:text-text-primary',
            )}
          >
            {item.label}
            {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-border-theme" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center gap-1 rounded-lg bg-surface-primary p-0.5', className)}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-body-xs transition-colors disabled:cursor-not-allowed disabled:text-text-disabled',
              active ? 'bg-link-tonal text-text-theme ring-1 ring-inset ring-border-theme' : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
