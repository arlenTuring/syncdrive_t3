import { readFieldFromRecord } from './resolveFieldValue';

/** 欄位值是否視為「燈亮」 */
export function isVehicleLightOn(
  data: Record<string, unknown> | null,
  visibilityField: string | undefined,
): boolean {
  if (!visibilityField?.trim()) return true;
  const raw = readFieldFromRecord(data, visibilityField.trim());
  if (raw === null || raw === undefined || raw === '') return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

/** 編輯模式一律顯示以便擺位；檢視模式依 visibilityField 開關 */
export function shouldRenderVehicleLight(
  data: Record<string, unknown> | null,
  visibilityField: string | undefined,
  isEditMode: boolean,
): boolean {
  if (isEditMode) return true;
  return isVehicleLightOn(data, visibilityField);
}
