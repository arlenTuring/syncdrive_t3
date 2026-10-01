import type { CanvasElementProps } from '../types';
import type { VariableMap } from '../VariableContext';

/**
 * 子畫布／樣板編輯時注入的變數：群組真實資料的第 rowIndex 列。
 *
 * 原本這裡注入的是寫死的示範列（S0000、PMS01、00:30:00…），編輯畫面上每個欄位都
 * 「有值」，但那些值不是任何資料來源給的。現在只放真實列；沒有列就只放群組變數本身，
 * 文字元件會顯示 {欄位名}，一看就知道沒有資料。
 */
export function buildGroupPreviewVariables(
  group: CanvasElementProps,
  row: Record<string, unknown> | null,
  rowIndex: number,
): VariableMap {
  const varName = group.variableName || 'item';
  const indexMode = (group.groupVariableMode ?? 'row') === 'index';
  const iteratorValue = indexMode
    ? rowIndex
    : row
      ? row[group.iteratorField || 'shift_key']
      : undefined;
  return {
    ...(row ?? {}),
    ...(iteratorValue !== undefined ? { [varName]: iteratorValue } : {}),
  } as VariableMap;
}

/** 子畫布編輯平面最小尺寸（邏輯像素，可在此範圍內放置元件） */
export const SUBCANVAS_MIN_EDIT_W = 960;
export const SUBCANVAS_MIN_EDIT_H = 540;

/**
 * 子畫布編輯：大平面供排版，designW×H 為執行時範本裁切區（虛線標示）
 */
export function computeSubcanvasEditPlane(group: CanvasElementProps) {
  const designW = group.templateWidth || 300;
  const designH = group.templateHeight || 200;
  return {
    designW,
    designH,
    editW: Math.max(designW, SUBCANVAS_MIN_EDIT_W),
    editH: Math.max(designH, SUBCANVAS_MIN_EDIT_H),
  };
}
