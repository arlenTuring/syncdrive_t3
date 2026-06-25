import type { CanvasElementProps, ChildWidget, DualCanvasDisplayGate, DualCanvasGateOperator } from '../types';

export type DualCanvasLane = 'default' | 'normal';

export const TEMPLATE_CANVAS_DEFAULT = 'template-canvas-default';
export const TEMPLATE_CANVAS_NORMAL = 'template-canvas-normal';
export const TEMPLATE_GATE_SETTINGS = 'template-gate-settings';
export const TEMPLATE_CANVAS_LEGACY = 'template-canvas';

export const DUAL_CANVAS_GAP_W = 56;

/** 子畫布編輯：雙畫板並排（不共用元件樹） */
export function computeDualSubcanvasEditPlane(group: CanvasElementProps) {
  const designW = group.templateWidth || 300;
  const designH = group.templateHeight || 200;
  const laneW = Math.max(designW, 420);
  const laneH = Math.max(designH, 320);
  const editW = laneW * 2 + DUAL_CANVAS_GAP_W;
  const editH = laneH;
  return { designW, designH, laneW, laneH, gapW: DUAL_CANVAS_GAP_W, editW, editH };
}

export function isDualCanvasGroup(el: CanvasElementProps | null | undefined): boolean {
  return !!el?.isGroup && !!el.dualCanvasEnabled;
}

export function getNormalChildren(el: CanvasElementProps): ChildWidget[] {
  if (el.childrenNormal?.length) return el.childrenNormal;
  return el.children ?? [];
}

export function getDefaultChildren(el: CanvasElementProps): ChildWidget[] {
  return el.childrenDefault ?? [];
}

export function laneFromTemplateCanvasId(canvasId: string | null): DualCanvasLane | 'gate' | null {
  if (canvasId === TEMPLATE_CANVAS_DEFAULT) return 'default';
  if (canvasId === TEMPLATE_CANVAS_NORMAL || canvasId === TEMPLATE_CANVAS_LEGACY) return 'normal';
  if (canvasId === TEMPLATE_GATE_SETTINGS) return 'gate';
  return null;
}

export function findChildInGroup(
  group: CanvasElementProps,
  childId: string | null,
  lane: DualCanvasLane | null,
): ChildWidget | null {
  if (!childId) return null;
  if (isDualCanvasGroup(group) && lane === 'default') {
    return getDefaultChildren(group).find(c => c.id === childId) ?? null;
  }
  if (isDualCanvasGroup(group) && lane === 'normal') {
    return getNormalChildren(group).find(c => c.id === childId) ?? null;
  }
  return group.children.find(c => c.id === childId) ?? null;
}

function parseCompareValue(raw: string | undefined): string | number | boolean {
  const t = raw?.trim() ?? '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (t !== '' && !Number.isNaN(n)) return n;
  return t;
}

function coerceSignalValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const s = String(value).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (s !== '' && !Number.isNaN(n)) return n;
  return s;
}

export function evaluateDualCanvasGate(
  gate: DualCanvasDisplayGate | undefined,
  rowCount: number,
  firstRow: Record<string, unknown> | null,
): boolean {
  const g = gate ?? { signal: 'rowCount', operator: 'gte', compareValue: '1' };
  const op: DualCanvasGateOperator = g.operator ?? 'gte';
  const signal = g.signal?.trim() || 'rowCount';

  let left: string | number | boolean | null | undefined;
  if (signal === 'rowCount') {
    left = rowCount;
  } else if (firstRow && signal in firstRow) {
    left = coerceSignalValue(firstRow[signal]);
  } else {
    left = undefined;
  }

  const right = parseCompareValue(g.compareValue);

  switch (op) {
    case 'empty':
      return rowCount === 0;
    case 'not_empty':
      return rowCount > 0;
    case 'eq':
      return left === right || String(left) === String(right);
    case 'neq':
      return left !== right && String(left) !== String(right);
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    default:
      return rowCount >= 1;
  }
}

/** 執行時是否顯示常態畫板（否則顯示預設畫板） */
export function shouldShowNormalPanel(
  element: CanvasElementProps,
  rowCount: number,
  firstRow: Record<string, unknown> | null,
): boolean {
  if (!isDualCanvasGroup(element)) return true;
  if (element.defaultPanelEnabled === false) return true;
  return evaluateDualCanvasGate(element.displayGate, rowCount, firstRow);
}

export function patchGroupChildrenByLane(
  el: CanvasElementProps,
  lane: DualCanvasLane,
  updater: (children: ChildWidget[]) => ChildWidget[],
): CanvasElementProps {
  if (!el.dualCanvasEnabled) {
    return { ...el, children: updater(el.children ?? []) };
  }
  if (lane === 'default') {
    return { ...el, childrenDefault: updater(getDefaultChildren(el)) };
  }
  const current = getNormalChildren(el);
  const next = updater(current);
  return { ...el, childrenNormal: next, children: next };
}

/** 啟用雙畫板時將既有 children 移入 childrenNormal */
export function enableDualCanvasOnGroup(el: CanvasElementProps): CanvasElementProps {
  if (!el.isGroup) return el;
  return {
    ...el,
    dualCanvasEnabled: true,
    defaultPanelEnabled: el.defaultPanelEnabled ?? true,
    childrenNormal: el.childrenNormal?.length ? el.childrenNormal : [...(el.children ?? [])],
    childrenDefault: el.childrenDefault ?? [],
    displayGate: el.displayGate ?? {
      signal: 'rowCount',
      operator: 'gte',
      compareValue: '1',
    },
  };
}
