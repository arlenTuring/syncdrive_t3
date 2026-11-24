import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';

/**
 * 頁籤（design-specs/t3-tabs-engineering-spec.md；樣式在 tabs.css，逐字取自規格 §6）。
 *
 * - Tabs：切換整塊內容。七種樣式：top／bottom／tonal／fill-h／fill-v／left／right，預設 bottom
 *   （選取標記在下緣，跟一般頁面上方分頁的用法一致）。
 * - SegmentedControl：一小組互斥的條件（例如「1 小時／6 小時／24 小時」），外觀用規格的 Tonal，語意維持單選。
 *
 * 鍵盤照規格 §4：水平樣式左右鍵、直向樣式上下鍵，兩端循環，Home／End 到頭尾；只有選取的那一顆在 Tab 順序裡。
 */

export type TabsVariant = 'top' | 'bottom' | 'tonal' | 'fill-h' | 'fill-v' | 'left' | 'right';

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  /** Leading Icon（16×16） */
  icon?: ReactNode;
  /** 數字徽章 */
  badge?: ReactNode;
};

const VERTICAL = new Set<TabsVariant>(['fill-v', 'left', 'right']);

function TabList<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  variant,
  role,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
  variant: TabsVariant;
  role: 'tablist' | 'radiogroup';
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const axis = VERTICAL.has(variant) ? 'vertical' : 'horizontal';
  const hasIcons = items.some((item) => item.icon != null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    // 輸入法組字期間不處理方向鍵
    if (event.nativeEvent.isComposing) return;
    const prev = axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = axis === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled);
    if (enabled.length === 0) return;
    const at = enabled.findIndex(({ index }) => index === from);
    let target: number | null = null;
    if (event.key === prev) target = enabled[(at - 1 + enabled.length) % enabled.length]!.index;
    else if (event.key === next) target = enabled[(at + 1) % enabled.length]!.index;
    else if (event.key === 'Home') target = enabled[0]!.index;
    else if (event.key === 'End') target = enabled[enabled.length - 1]!.index;
    if (target == null) return;
    event.preventDefault();
    const id = items[target]!.id;
    onChange(id);
    buttons.current.get(id)?.focus();
  };

  return (
    <div
      role={role}
      aria-label={label}
      aria-orientation={role === 'tablist' ? axis : undefined}
      className={cn('t3-tabs__list', className)}
      data-style={variant}
      data-axis={axis}
      data-icons={hasIcons ? 'true' : 'false'}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <div
            key={item.id}
            className="t3-tab"
            data-style={variant}
            data-active={active ? 'true' : 'false'}
            data-disabled={item.disabled ? 'true' : undefined}
            style={item.disabled ? ({ '--tab-text': 'var(--text-disabled)' } as CSSProperties) : undefined}
          >
            <button
              ref={(node) => {
                if (node) buttons.current.set(item.id, node);
                else buttons.current.delete(item.id);
              }}
              type="button"
              className="t3-tab__trigger"
              role={role === 'tablist' ? 'tab' : 'radio'}
              aria-selected={role === 'tablist' ? active : undefined}
              aria-checked={role === 'radiogroup' ? active : undefined}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => move(event, index)}
            >
              {/* 可存取名稱放在按鈕裡（視覺上隱藏）；看得到的內容層照規格疊在上面、不攔截指標 */}
              <span className="sr-only">{item.label}</span>
            </button>
            <span className="t3-tab__content" aria-hidden>
              {item.icon ? <span className="t3-tab__icon">{item.icon}</span> : null}
              <span className="t3-tab__label">{item.label}</span>
              {item.badge != null ? <span className="t3-tab__badge">{item.badge}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  variant = 'bottom',
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** 頁籤群組的可及名稱 */
  label?: string;
  className?: string;
  variant?: TabsVariant;
}) {
  return <TabList items={items} value={value} onChange={onChange} label={label} className={className} variant={variant} role="tablist" />;
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
  return <TabList items={options} value={value} onChange={onChange} label={label} className={className} variant="tonal" role="radiogroup" />;
}
