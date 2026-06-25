/**
 * 設計稿「4. 作動行為」— 行駛途中車輛可能執行的動作
 * 圖示檔請放在 public/vehicle-operation-actions/icons/
 */
export const VEHICLE_OPERATION_ACTION_ICONS_BASE = '/vehicle-operation-actions/icons';

export interface VehicleOperationActionDef {
  /** 資料庫／MQTT 建議用的代碼 */
  code: string;
  label: string;
  iconFile: string;
}

export const VEHICLE_OPERATION_ACTION_CATALOG: VehicleOperationActionDef[] = [
  { code: 'enter', label: '進站', iconFile: 'enter.png' },
  { code: 'exit', label: '出站', iconFile: 'exit.png' },
  { code: 'music', label: '音樂', iconFile: 'music.png' },
  { code: 'door_open', label: '開門', iconFile: 'door-open.png' },
  { code: 'door_close', label: '關門', iconFile: 'door-close.png' },
  { code: 'signal', label: '號誌', iconFile: 'signal.png' },
  { code: 'alert', label: '告警', iconFile: 'alert.png' },
  { code: 'dispatch', label: '調度', iconFile: 'dispatch.png' },
  { code: 'charging', label: '充電', iconFile: 'charging.png' },
  { code: 'wash', label: '洗車', iconFile: 'wash.png' },
  { code: 'maintenance', label: '保養', iconFile: 'maintenance.png' },
  { code: 'repair', label: '維修', iconFile: 'repair.png' },
  { code: 'parking', label: '臨停', iconFile: 'parking.png' },
];

export function operationActionIconUrl(iconFile: string): string {
  const name = iconFile.trim().replace(/^\/+/, '');
  if (!name) return '';
  if (name.startsWith('behaviors/')) return `/vehicle-editor/${name}`;
  return `${VEHICLE_OPERATION_ACTION_ICONS_BASE}/${name}`;
}

/** @deprecated 請改用 operationActionIconUrl */
export const routeProgressIconUrl = operationActionIconUrl;
