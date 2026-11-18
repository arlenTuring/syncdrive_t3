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
  mapBackground: '#1F262F',
  roadFill: '#364153',
  roadDivider: '#1E2939',
  stationFill: '#2B7FFF',
  primaryText: '#F3F4F6',
  secondaryText: '#D1D5DC',
  mutedText: '#99A1AF',
  accentBlue: '#51A2FF',
  directionPurple: '#8E51FF',
  cardBackground: '#1F262F',
  cardBorder: '#4A5565',
  itemBackground: '#1E2939',
  itemHover: '#364153',
  zoneBackground: '#1F262F',
  zoneSectionBackground: '#1E2939',
  zoneBorder: '#1E2939',
  slotBackground: '#364153',
  entranceStroke: '#2B7FFF',
  healthy: '#00D492',
  warning: '#FFBA00',
  danger: '#FF6467',
  focusRing: '#51A2FF',
} as const;

export type MapPlatformThemeToken = keyof typeof MAP_PLATFORM_THEME;
