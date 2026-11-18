/**
 * 設計系統 tokens 的程式端入口（給 canvas、SVG 屬性、圖表設定、inline style 用）。
 *
 * 數值只存在 styles/design-tokens.css 一處；這裡只列名稱，並提供兩種取用方式：
 *   - tokenVar('status-error')  → 'var(--status-error)'：SVG fill／stroke、style 物件直接用，會跟著 CSS 變。
 *   - readToken('status-error') → 'rgb(251 44 54)' 之類的實際色值：canvas、需要真實字串的圖表套件用。
 *
 * Tailwind class 寫得出來的地方（bg-surface-primary、text-text-secondary…）一律用 class，不要繞到這裡。
 * 名稱清單跟 CSS 是否一致，由 tokens.spec.ts 檢查。
 */

export const SEMANTIC_TOKENS = [
  'surface-primary', 'surface-secondary', 'surface-tertiary', 'surface-disabled', 'surface-invert',
  'surface-theme', 'surface-theme-light', 'surface-background', 'surface-sub-background', 'surface-popup',
  'surface-sub-popup',
  'text-primary', 'text-secondary', 'text-tertiary', 'text-quaternary', 'text-disabled', 'text-invert',
  'text-theme', 'text-theme-light',
  'border-primary', 'border-secondary', 'border-tertiary', 'border-quaternary', 'border-disabled',
  'border-invert', 'border-invert-light', 'border-theme', 'border-theme-light', 'border-theme-light-trn',
  'border-danger-light',
  'link-theme-filled', 'link-theme-filled-hover', 'link-theme-filled-pressed',
  'link-black-filled', 'link-black-filled-hover', 'link-black-filled-pressed',
  'link-tonal', 'link-tonal-hover', 'link-tonal-pressed',
  'link-standard', 'link-standard-hover', 'link-standard-pressed',
  'link-danger-filled', 'link-danger-filled-hover', 'link-danger-filled-pressed',
  'link-danger-tonal', 'link-danger-tonal-hover', 'link-danger-tonal-pressed',
  'cta', 'cta-hover',
  'status-error', 'status-error-emphasis', 'status-error-light',
  'status-warning', 'status-warning-emphasis', 'status-warning-light',
  'status-success', 'status-success-emphasis', 'status-success-light',
  'status-info', 'status-info-emphasis', 'status-info-light',
  'status-inactive', 'status-inactive-light',
] as const;

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

/** 設計稿字級（Tailwind utility 名稱是 text-<名稱>） */
export const TYPE_SCALE = [
  'display-l', 'display-m', 'display-s',
  'headline-1', 'headline-2', 'headline-3', 'headline-4', 'headline-5',
  'body-l', 'body-l-bold', 'body-m', 'body-m-bold', 'body-s', 'body-s-bold', 'body-xs', 'body-xs-bold',
  'caption-1', 'caption-2', 'caption-3',
] as const;

export type TypeScale = (typeof TYPE_SCALE)[number];

/** 色票色名與色階（color-<色名>-<色階>）；white／black 是透明度階 */
export type PaletteHue =
  | 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone' | 'red' | 'orange' | 'amber' | 'yellow' | 'lime'
  | 'green' | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'fuchsia'
  | 'pink' | 'rose';
export type PaletteStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type PaletteToken =
  | `color-${PaletteHue}-${PaletteStep}`
  | `color-white-${40 | 50 | 80 | 100}`
  | `color-black-${5 | 10 | 16 | 30 | 50 | 100}`;

export type DesignToken = SemanticToken | PaletteToken;

/** CSS 變數參照：'var(--surface-primary)' */
export function tokenVar(name: DesignToken): string {
  return `var(--${name})`;
}

/**
 * 實際色值（瀏覽器算好的字串）。canvas 這類不吃 var() 的地方用。
 * 沒有瀏覽器環境（測試、伺服器端）時回傳 var() 參照，呼叫端照樣能用在 SVG／CSS。
 */
export function readToken(name: DesignToken, element?: Element | null): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return tokenVar(name);
  const target = element ?? document.documentElement;
  const raw = getComputedStyle(target).getPropertyValue(`--${name}`).trim();
  if (!raw) return tokenVar(name);
  // 語意色多半是 var()／rgb(from …) 組出來的：交給瀏覽器算成最終色值
  if (/^(var|rgb\(from|color-mix)\(/.test(raw)) {
    const probe = document.createElement('span');
    probe.style.color = raw;
    probe.style.display = 'none';
    target.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved || tokenVar(name);
  }
  return raw;
}

/** 狀態語意：故障／錯誤、警告、正常、資訊、離線或未啟用 */
export type StatusTone = 'error' | 'warning' | 'success' | 'info' | 'inactive';

/**
 * 規格字型（與 design-tokens.css 的 --font-primary 相同）。
 * 給 inline style 與 SVG 的 font-family 屬性用：SVG 屬性不吃 var()，所以這裡是字面值。
 */
export const FONT_FAMILY_PRIMARY = "'Noto Sans TC Variable', 'Noto Sans TC', sans-serif";
