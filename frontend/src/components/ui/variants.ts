/**
 * 共用元件的樣式定義（class 字串）。元件與「不是元件、但要長得一樣」的地方（例如 <a>、
 * 第三方元件的 className）都從這裡取，不要在頁面裡另外拼一套。
 *
 * 顏色、字級只用設計系統 token（styles/design-tokens.css）。間距、圓角、尺寸設計稿還沒給，
 * 先統一定在這裡；設計稿補齊後只改這個檔。
 */
import type { StatusTone } from '../../styles/tokens';
import { cn } from './cn';

/* ───────────── 按鈕（配色在 button.css，取自 T3 UI Kit 工程文件；元件見 Button.tsx） ───────────── */

/** superior＝主要（主題色）、subordinate＝次要（灰階）、danger＝危險（刪除、清除） */
export type ButtonHierarchy = 'superior' | 'subordinate' | 'danger';
/** Button 的 Style */
export type ButtonStyle = 'filled' | 'tonal' | 'outlined' | 'standard' | 'text';
/** IconButton 的 Style */
export type IconButtonStyle = 'filled' | 'tonal' | 'outlined' | 'standard' | 'icon';
export type IconButtonSize = 'medium' | 'small';

/** 不是 <button> 但要長得一樣（例如 <a>、<label>）時，把這些屬性展開上去 */
export function buttonAttributes(hierarchy: ButtonHierarchy = 'superior', variant: ButtonStyle = 'filled') {
  return { className: 't3-button text-body-s-bold', 'data-hierarchy': hierarchy, 'data-style': variant } as const;
}


/* ───────────── 輸入框（TextField 規格；樣式在 field/field.css） ───────────── */

export type FieldSize = 'sm' | 'md';
/** 欄位三種 Style（TextField／Dropdown／DatePicker／InputNumber 共用）；預設 Tonal-Theme */
export type FieldStyle = 'tonal-theme' | 'tonal-gray' | 'outlined';

/** 文字、數字、日期、select 共用的輸入框外觀；invalid 時描邊轉錯誤色。fullWidth=false 時寬度由呼叫端決定 */
export function fieldClass(options: { size?: FieldSize; invalid?: boolean; multiline?: boolean; fullWidth?: boolean; style?: FieldStyle } = {}): string {
  const { size = 'md', invalid = false, multiline = false, fullWidth = true, style = 'tonal-theme' } = options;
  return cn(
    't3-input',
    invalid && 't3-input--error',
    style !== 'tonal-theme' && `t3-input--${style}`,
    fullWidth && 'w-full',
    !multiline && size === 'sm' && 't3-input--sm',
  );
}

/** 欄位標題：14/18、500、text-tertiary，左右 8px，跟欄位距 4px */
export const LABEL_CLASS = 'block px-2 text-body-s-bold text-text-tertiary';
/** 輔助文字：12/16、text-tertiary，上下 4px 左右 12px */
export const HINT_CLASS = 'px-3 py-1 text-body-xs text-text-tertiary';
export const ERROR_TEXT_CLASS = 'px-3 py-1 text-body-xs text-status-error';

/* ───────────── 面板（卡片） ───────────── */

export type SurfaceLevel =
  | 'background' // 頁面底
  | 'sub-background' // 側欄、最深的底
  | 'primary' // 卡片、面板
  | 'secondary' // 卡片內再分區
  | 'popup' // 對話框、下拉選單
  | 'sub-popup'; // 對話框內分區

const SURFACE_BG: Record<SurfaceLevel, string> = {
  background: 'bg-surface-background',
  'sub-background': 'bg-surface-sub-background',
  primary: 'bg-surface-primary',
  secondary: 'bg-surface-secondary',
  popup: 'bg-surface-popup',
  'sub-popup': 'bg-surface-sub-popup',
};

export function surfaceClass(level: SurfaceLevel = 'primary', options: { bordered?: boolean } = {}): string {
  return cn(SURFACE_BG[level], options.bordered !== false && level !== 'background' && 'border border-border-quaternary');
}

/* ───────────── 狀態標籤 ───────────── */

export type BadgeTone = StatusTone | 'theme' | 'neutral';

const BADGE_TONES: Record<BadgeTone, { container: string; dot: string }> = {
  error: { container: 'bg-status-error-light text-status-error-emphasis', dot: 'bg-status-error' },
  warning: { container: 'bg-status-warning-light text-status-warning-emphasis', dot: 'bg-status-warning' },
  success: { container: 'bg-status-success-light text-status-success-emphasis', dot: 'bg-status-success' },
  info: { container: 'bg-status-info-light text-status-info-emphasis', dot: 'bg-status-info' },
  inactive: { container: 'bg-status-inactive-light text-status-inactive', dot: 'bg-status-inactive' },
  theme: { container: 'bg-surface-theme text-text-theme', dot: 'bg-border-theme' },
  neutral: { container: 'bg-link-standard text-text-secondary', dot: 'bg-text-tertiary' },
};

/** 只有顏色的部分（底色＋文字色、圓點色）：外框尺寸不同的標籤（StatusTag）共用同一套配色 */
export function badgeToneColors(tone: BadgeTone = 'neutral'): { container: string; dot: string } {
  return BADGE_TONES[tone];
}


/* ───────────── 對話框 ───────────── */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export const DIALOG_WIDTHS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
  full: 'max-w-[min(96vw,1400px)]',
};

export const DIALOG_OVERLAY_CLASS = 'fixed inset-0 flex items-center justify-center bg-black-50 p-4 backdrop-blur-sm';
/** 外框：圓角 16、四層陰影、底色 surface-popup（dialog/dialog.css 的 .t3-dialog-surface，取自 Dialog 工程規範） */
export const DIALOG_PANEL_CLASS = 't3-dialog-surface flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden';

/* ───────────── 浮層選單（下拉、選項清單、日期選擇器） ───────────── */

/** 下拉選單：底色 surface-background、圓角 8、上下 4px、最高 312px（Dropdown 規格 §4） */
export const MENU_PANEL_CLASS = 't3-menu-panel max-h-78 overflow-y-auto rounded-lg bg-surface-background py-1';
export const MENU_GROUP_LABEL_CLASS = 'px-3 py-2 text-caption-1 text-text-quaternary';
export const MENU_EMPTY_CLASS = 'px-3 py-2 text-body-s text-text-quaternary';
export const MENU_BADGE_CLASS = 'shrink-0 text-body-xs text-text-quaternary';
export const MENU_CHECK_CLASS = 'size-4 shrink-0 text-text-theme';

/** 選單的一個選項（高 40、左右 20、hover link-standard）；active＝目前選取，文字用主題色（Dropdown 規格 §4） */
export function menuItemClass(active = false): string {
  return cn(
    'flex min-h-10 w-full items-center gap-2 px-5 text-left text-body-s transition-colors hover:bg-link-standard focus-visible:bg-link-standard focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-disabled',
    active ? 'text-text-theme' : 'text-text-primary',
  );
}

/** 下拉選單跟欄位的距離（Tonal 樣式 7px） */
export const MENU_OFFSET = 7;

/** 觸發浮層的按鈕（select、日期）未選值時的提示字色、箭頭圖示色 */
/** 「請選擇」：未展開 text-tertiary（展開時呼叫端改 text-primary）；箭頭 20×20、text-tertiary（Dropdown 規格 §2、§3） */
export const PLACEHOLDER_TEXT_CLASS = 'text-text-tertiary';
export const TRIGGER_ICON_CLASS = 'size-5 shrink-0 text-text-tertiary';
