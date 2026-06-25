import { getByPath } from '../../dashboard/utils/jsonPath';
import { FIELD_PREVIEW_SAMPLES, normalizeValueFieldKey } from '../../dashboard/utils/widgetEditPreview';

export function readFieldFromRecord(
  data: Record<string, unknown> | null,
  field: string,
): unknown {
  if (!data || !field.trim()) return undefined;
  const key = normalizeValueFieldKey(field) ?? field.trim();
  const dotted = getByPath(data, key);
  if (dotted !== undefined) return dotted;
  return data[key];
}

/** previewData 為底，即時資料補缺欄；previewData 明確設定的欄位優先（測試面板／手動預覽） */
export function mergeVehiclePreviewData(
  live: Record<string, unknown> | null,
  preview: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!preview || Object.keys(preview).length === 0) return live;
  if (!live) return preview;
  return { ...live, ...preview };
}

/** 文字欄位：trip_code 可回落 badge_label（與儀表板／SQL 慣例一致） */
export function readVehicleTextField(
  data: Record<string, unknown> | null,
  valueField: string,
): unknown {
  const key = normalizeValueFieldKey(valueField) ?? valueField.trim();
  const raw = readFieldFromRecord(data, key);
  if (raw !== undefined && raw !== null && raw !== '') return raw;
  if (key === 'trip_code') {
    const badge = readFieldFromRecord(data, 'badge_label');
    if (badge !== undefined && badge !== null && badge !== '') return badge;
  }
  return raw;
}

export function resolveVehicleTextDisplay(
  data: Record<string, unknown> | null,
  valueField: string,
  isEditMode: boolean,
): string {
  const key = normalizeValueFieldKey(valueField) ?? valueField.trim();
  const formatted = formatFieldDisplay(readVehicleTextField(data, key));
  if (formatted) return formatted;
  if (!isEditMode) return '';
  if (FIELD_PREVIEW_SAMPLES[key]) return FIELD_PREVIEW_SAMPLES[key];
  return `{${key}}`;
}

export function formatFieldDisplay(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}
