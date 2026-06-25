import { operationActionIconUrl } from './actionCatalog';

/** 路線進度預設車體圖-main SVG（圓角底可染色） */
export const DEFAULT_VEHICLE_ICON_FILE = 'vehicle.svg';

const IMAGE_EXT = /\.(png|svg|webp|jpe?g)(\?.*)?$/i;

/** 是否為可染色的 vehicle 車體圖 */
export function isVehicleBodyIcon(vehicleIcon: string): boolean {
  const name = vehicleIcon.trim().replace(/^\/+/, '').split('/').pop()?.toLowerCase() ?? '';
  return name === 'vehicle.svg' || name === 'vehicle.png';
}

/** 是否為圖檔路徑（非 Lucide 名稱） */
export function isVehicleIconImage(vehicleIcon: string): boolean {
  const v = vehicleIcon.trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('http://') || v.startsWith('https://')) return true;
  return IMAGE_EXT.test(v);
}

/** 解析車輛圖示 URL；Lucide 名稱則回傳 null */
export function resolveVehicleIconImageUrl(vehicleIcon: string): string | null {
  const v = vehicleIcon.trim();
  if (!isVehicleIconImage(v)) return null;
  if (v.startsWith('/') || v.startsWith('http://') || v.startsWith('https://')) return v;
  return operationActionIconUrl(v);
}
