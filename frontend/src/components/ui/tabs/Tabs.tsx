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

/** 規格的 More（more_horiz）原稿圖示（t3-tabs-playground.html 的 TABS_ICONS.more，路徑逐字） */
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6.23077 13.5C5.81827 13.5 5.46519 13.3531 5.17152 13.0592C4.87769 12.7656 4.73077 12.4125 4.73077 12C4.73077 11.5875 4.87769 11.2344 5.17152 10.9408C5.46519 10.6469 5.81827 10.5 6.23077 10.5C6.64327 10.5 6.99644 10.6469 7.29027 10.9408C7.58394 11.2344 7.73077 11.5875 7.73077 12C7.73077 12.4125 7.58394 12.7656 7.29027 13.0592C6.99644 13.3531 6.64327 13.5 6.23077 13.5ZM12 13.5C11.5875 13.5 11.2344 13.3531 10.9408 13.0592C10.6469 12.7656 10.5 12.4125 10.5 12C10.5 11.5875 10.6469 11.2344 10.9408 10.9408C11.2344 10.6469 11.5875 10.5 12 10.5C12.4125 10.5 12.7656 10.6469 13.0593 10.9408C13.3531 11.2344 13.5 11.5875 13.5 12C13.5 12.4125 13.3531 12.7656 13.0593 13.0592C12.7656 13.3531 12.4125 13.5 12 13.5ZM17.7693 13.5C17.3568 13.5 17.0036 13.3531 16.7098 13.0592C16.4161 12.7656 16.2693 12.4125 16.2693 12C16.2693 11.5875 16.4161 11.2344 16.7098 10.9408C17.0036 10.6469 17.3568 10.5 17.7693 10.5C18.1818 10.5 18.5349 10.6469 18.8285 10.9408C19.1224 11.2344 19.2693 11.5875 19.2693 12C19.2693 12.4125 19.1224 12.7656 18.8285 13.0592C18.5349 13.3531 18.1818 13.5 17.7693 13.5Z" />
    </svg>
  );
}

/** Fill-V 的標題逐字直立排列（照 grapheme 拆，不旋轉字母） */
function verticalChars(label: ReactNode): ReactNode {
  if (typeof label !== 'string') return label;
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  const chars = Segmenter ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(label)].map((p) => p.segment) : [...label];
  return chars.map((ch, i) => <span key={i} className="t3-tab__char">{ch}</span>);
}

/** 把既有的內容容器標成 tabpanel（不多包一層、不影響排版）：{...tabPanelProps(idBase, value)} */
export function tabPanelProps(idBase: string, activeId: string) {
  return { role: 'tabpanel' as const, id: `${idBase}-panel`, 'aria-labelledby': `${idBase}-tab-${activeId}`, tabIndex: 0 };
}

/** 頁籤對應的內容面板：給 Tabs 同一個 idBase，讀屏會把頁籤跟內容關聯起來（規格 §4 tablist／tab／tabpanel） */
export function TabPanel({ idBase, activeId, className, children }: { idBase: string; activeId: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${activeId}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}

const VERTICAL = new Set<TabsVariant>(['fill-v', 'left', 'right']);

function TabList<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  variant,
  role,
  idBase,
  onMore,
  panelPerTab = false,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
  variant: TabsVariant;
  role: 'tablist' | 'radiogroup';
  idBase?: string;
  onMore?: (id: T) => void;
  panelPerTab?: boolean;
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
              id={idBase ? `${idBase}-tab-${item.id}` : undefined}
              aria-controls={idBase && role === 'tablist' ? (panelPerTab ? `${idBase}-panel-${item.id}` : `${idBase}-panel`) : undefined}
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
            <span className="t3-tab__content">
              {item.icon ? <span className="t3-tab__icon" aria-hidden>{item.icon}</span> : null}
              <span className="t3-tab__label" aria-hidden>{variant === 'fill-v' ? verticalChars(item.label) : item.label}</span>
              {item.badge != null ? <span className="t3-tab__badge" aria-hidden>{item.badge}</span> : null}
              {/* More 是獨立的同層按鈕（不巢狀在頁籤按鈕裡），點了只發更多操作、不切換頁籤 */}
              {onMore ? (
                <button type="button" className="t3-tab__more" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); onMore(item.id); }}>
                  <MoreIcon />
                </button>
              ) : null}
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
  idBase,
  onMore,
  panelPerTab = false,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** 頁籤群組的可及名稱 */
  label?: string;
  className?: string;
  variant?: TabsVariant;
  /** 給了就跟 <TabPanel idBase> 關聯（aria-controls／aria-labelledby） */
  idBase?: string;
  /** 每個頁籤右側的 More 按鈕（規格預設關，給了才顯示） */
  onMore?: (id: T) => void;
  /** 每個頁籤各有一個內容面板（id＝`${idBase}-panel-${頁籤 id}`）；預設共用一個 `${idBase}-panel` */
  panelPerTab?: boolean;
}) {
  return <TabList items={items} value={value} onChange={onChange} label={label} className={className} variant={variant} role="tablist" idBase={idBase} onMore={onMore} panelPerTab={panelPerTab} />;
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
