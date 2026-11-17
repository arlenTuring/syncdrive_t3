import type { CheckboxChecked } from './Checkbox';

/** 表頭全選的狀態：全部勾＝true、部分＝'mixed'、零筆可選或零筆已選＝false（文件 §3） */
export function headerCheckState(selectedCount: number, selectableCount: number): CheckboxChecked {
  if (selectableCount <= 0 || selectedCount <= 0) return false;
  return selectedCount >= selectableCount ? true : 'mixed';
}
