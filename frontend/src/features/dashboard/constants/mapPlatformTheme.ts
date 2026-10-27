/**
 * 圖台（即時圖台與站點到站卡片）的固定色票。
 *
 * 來源：document/圖台配色與到站動態卡片改版_Claude_Code實作指示.md §3。大面積純色與文字色是從
 * 設計原圖取樣；細邊線、互動與狀態色是該文件補齊的實作規範。只給圖台範圍用，不是全站主題。
 *
 * 地圖本身的道路、站點、場區、格位顏色存在圖資的樣式欄位（defaultFillColor／strokeColor／
 * labelStyle.color），由 backend/scripts/maintenance/apply-map-platform-palette.js 依同一份色票
 * 寫入；這裡的數值改了，那支腳本的對照表也要一起改。
 */
export const MAP_PLATFORM_THEME = {
  mapBackground: '#212734',
  roadFill: '#354357',
  roadDivider: '#28303E',
  stationFill: '#2B7FFF',
  primaryText: '#F3F4F6',
  secondaryText: '#D1D5DC',
  mutedText: '#9CA3AF',
  accentBlue: '#51A2FF',
  directionPurple: '#8E51FF',
  cardBackground: '#212734',
  cardBorder: '#4E525C',
  itemBackground: '#28303E',
  itemHover: '#2E394B',
  zoneBackground: '#252D3C',
  zoneSectionBackground: '#28303E',
  zoneBorder: '#293444',
  slotBackground: '#354357',
  entranceStroke: '#4D87DA',
  healthy: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  focusRing: '#51A2FF',
} as const;

export type MapPlatformThemeToken = keyof typeof MAP_PLATFORM_THEME;
