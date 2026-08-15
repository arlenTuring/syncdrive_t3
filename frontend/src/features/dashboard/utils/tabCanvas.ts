/**
 * Tab Canvas 工具函式
 * 平行於 dualCanvas.ts，處理「Tab 容器」的子畫布資料存取。
 *
 * 資料儲存策略：
 *   tabs[0].children ──> CanvasElementProps.children      (index 0 與既有欄位共存)
 *   tabs[1].children ──> CanvasElementProps.childrenTab1
 *   tabs[2].children ──> CanvasElementProps.childrenTab2
 *   ...以此類推，最多支援 9 個額外 Tab。
 *
 * 進入子畫布的虛擬 canvasId 前綴：'tab-canvas:<tabId>'
 */
import type { CanvasElementProps, ChildWidget, TabCanvasTab } from '../types';

// ─── 常數 ─────────────────────────────────────────────────────────────────────

export const TAB_CANVAS_ID_PREFIX = 'tab-canvas:';

/** 最多支援的 Tab 數量（含 Tab 0） */
export const TAB_CANVAS_MAX_TABS = 10;

/** 虛擬子畫布 ID → tabId 的映射鍵名 */
const TAB_CHILDREN_FIELDS: Record<number, keyof CanvasElementProps> = {
  0: 'children',
  1: 'childrenTab1',
  2: 'childrenTab2',
  3: 'childrenTab3',
  4: 'childrenTab4',
  5: 'childrenTab5',
  6: 'childrenTab6',
  7: 'childrenTab7',
  8: 'childrenTab8',
  9: 'childrenTab9',
};

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

/** 判斷是否為 Tab 容器 */
export function isTabCanvas(el: CanvasElementProps): boolean {
  return !!el.tabCanvasEnabled && (el.tabs?.length ?? 0) > 0;
}

/** 根據 tabId 找到 Tab 的 index */
export function tabIndexById(el: CanvasElementProps, tabId: string): number {
  return (el.tabs ?? []).findIndex(t => t.id === tabId);
}

/** 根據 Tab index 取得對應的 children 欄位名 */
export function tabChildrenField(index: number): keyof CanvasElementProps {
  return TAB_CHILDREN_FIELDS[index] ?? 'children';
}

/** 取得指定 Tab 的子元件樹 */
export function getTabChildren(el: CanvasElementProps, tabId: string): ChildWidget[] {
  const idx = tabIndexById(el, tabId);
  if (idx < 0) return [];
  const field = tabChildrenField(idx);
  const val = el[field];
  if (Array.isArray(val)) return val as ChildWidget[];
  return idx === 0 ? (el.children ?? []) : [];
}

/** 更新指定 Tab 的子元件樹（回傳新的 CanvasElementProps patch） */
export function buildTabChildrenPatch(
  el: CanvasElementProps,
  tabId: string,
  children: ChildWidget[],
): Partial<CanvasElementProps> {
  const idx = tabIndexById(el, tabId);
  if (idx < 0) return {};
  const field = tabChildrenField(idx);
  return { [field]: children };
}

/** 在指定 Tab 更新單一子元件 */
export function patchTabChild(
  el: CanvasElementProps,
  tabId: string,
  childId: string,
  patch: Partial<ChildWidget>,
): Partial<CanvasElementProps> {
  const children = getTabChildren(el, tabId);
  const updated = children.map(c => (c.id === childId ? ({ ...c, ...patch } as ChildWidget) : c));
  return buildTabChildrenPatch(el, tabId, updated);
}

/** 從指定 Tab 刪除子元件 */
export function deleteTabChild(
  el: CanvasElementProps,
  tabId: string,
  childId: string,
): Partial<CanvasElementProps> {
  const children = getTabChildren(el, tabId).filter(c => c.id !== childId);
  return buildTabChildrenPatch(el, tabId, children);
}

/** 向指定 Tab 新增子元件 */
export function addTabChild(
  el: CanvasElementProps,
  tabId: string,
  child: ChildWidget,
): Partial<CanvasElementProps> {
  const children = [...getTabChildren(el, tabId), child];
  return buildTabChildrenPatch(el, tabId, children);
}

// ─── 虛擬 canvasId 工具 ───────────────────────────────────────────────────────

/** tabId → 進入子畫布時使用的虛擬 canvasId */
export function makeTabCanvasId(tabId: string): string {
  return `${TAB_CANVAS_ID_PREFIX}${tabId}`;
}

/** 虛擬 canvasId → tabId（非 tab-canvas 回傳 null） */
export function parseTabCanvasId(virtualId: string): string | null {
  if (!virtualId.startsWith(TAB_CANVAS_ID_PREFIX)) return null;
  return virtualId.slice(TAB_CANVAS_ID_PREFIX.length);
}

/** 判斷 canvasId 是否為 Tab 子畫布虛擬 ID */
export function isTabCanvasId(id: string): boolean {
  return id.startsWith(TAB_CANVAS_ID_PREFIX);
}

// ─── Tab 管理 ─────────────────────────────────────────────────────────────────

/** 建立新 Tab（空子元件樹） */
export function createTab(label: string): TabCanvasTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    children: [],
  };
}
