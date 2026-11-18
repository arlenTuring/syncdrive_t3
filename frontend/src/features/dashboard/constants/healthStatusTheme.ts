/** 健康／連線狀態 → 邊框色（可於元件屬性覆寫） */

export type HealthStatus = 'OK' | 'WARNING' | 'ERROR' | 'OFFLINE';

export const HEALTH_STATUS_BORDER: Record<HealthStatus, string> = {
  OK: '#00BC7D',
  WARNING: '#FF8904',
  ERROR: '#FB2C36',
  OFFLINE: '#71717B',
};

export const HEALTH_STATUS_ICON_BG: Record<string, string> = {
  OK: '#51A2FF',
  WARNING: '#FF8904',
  ERROR: '#FB2C36',
  OFFLINE: '#71717B',
};
