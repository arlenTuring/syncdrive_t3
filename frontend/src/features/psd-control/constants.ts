/** 列表卡門位順序：右前 → 右後 → 左前 → 左後（對齊設計稿） */
export const VEHICLE_DOORS = [
  { id: 'rf', label: '右前' },
  { id: 'rr', label: '右後' },
  { id: 'lf', label: '左前' },
  { id: 'lr', label: '左後' },
] as const;

export type VehicleDoorId = (typeof VEHICLE_DOORS)[number]['id'];

export type ControlMode = 'auto' | 'manual';

/**
 * 列表指示器六態（對齊設計稿）
 * open＝常態開（綠分扇）、closing＝動作中關（橘）、closed＝常態關（藍）、
 * opening＝動作中開（橘）、alarm＝對位告警（紅）、offline＝失去連線（灰）
 */
export type DoorVisualState = 'open' | 'closing' | 'closed' | 'opening' | 'alarm' | 'offline';

export type DoorDisplayStateCode =
  | 'OPEN'
  | 'CLOSING'
  | 'CLOSED'
  | 'OPENING'
  | 'ALIGNMENT_ALARM'
  | 'OFFLINE';

export type DoorIndicatorModel = {
  visual: DoorVisualState;
  openPercent: number;
};
