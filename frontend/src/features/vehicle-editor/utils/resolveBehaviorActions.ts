import { resolveDashboardIconUrl } from '../../dashboard/constants/iconLibrary';
import type { RouteActionIconRule } from '../../dashboard/types';
import { resolveActionIconUrl } from '../../dashboard/route-progress/resolveActionIcon';
import { VEHICLE_BEHAVIOR_ACTION_CATALOG } from '../constants/behaviorActionCatalog';
import type { VehicleBehaviorElement } from '../types';

/** 視為「無作動／空行為」的代碼（不顯示任何行為圖示） */
const EMPTY_OPERATION_ACTION_CODES = new Set([
  '',
  'none',
  'idle',
  'empty',
  'null',
  'nil',
  'off',
  'noop',
  'no_op',
  'clear',
  '—',
  '-',
]);

function normalizeOperationActionCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const code = String(raw).trim();
  if (!code) return null;
  if (EMPTY_OPERATION_ACTION_CODES.has(code.toLowerCase())) return null;
  return code;
}

/** 讀取目前作用中的行為代碼（支援陣列、逗號分隔、單一值；空行為回傳 []） */
export function readOperationActions(
  data: Record<string, unknown> | null | undefined,
): string[] {
  if (!data) return [];

  const multi = data.operation_actions;
  if (Array.isArray(multi)) {
    return multi
      .map((v) => normalizeOperationActionCode(v))
      .filter((code): code is string => Boolean(code));
  }
  if (typeof multi === 'string' && multi.trim()) {
    return multi
      .split(',')
      .map((s) => normalizeOperationActionCode(s))
      .filter((code): code is string => Boolean(code));
  }

  const single = data.operation_action;
  if (typeof single === 'string' && single.includes(',')) {
    return single
      .split(',')
      .map((s) => normalizeOperationActionCode(s))
      .filter((code): code is string => Boolean(code));
  }
  const normalized = normalizeOperationActionCode(single);
  return normalized ? [normalized] : [];
}

export function resolveBehaviorIconUrl(
  rules: RouteActionIconRule[] | undefined,
  actionCode: string,
): string | null {
  const code = actionCode.trim();
  if (!code) return null;
  const rule = rules?.find(
    (r) => r.matchOp === 'eq' && String(r.threshold ?? '').trim() === code,
  );
  if (rule?.iconFile?.trim()) {
    const url = resolveDashboardIconUrl(rule.iconFile);
    if (url) return url;
  }
  const catalog = VEHICLE_BEHAVIOR_ACTION_CATALOG.find((a) => a.code === code);
  return catalog ? resolveDashboardIconUrl(catalog.iconFile) : null;
}

export function isBehaviorElementActive(
  element: VehicleBehaviorElement,
  data: Record<string, unknown> | null,
  isEditMode: boolean,
): boolean {
  if (isEditMode) return true;
  if (!data) return false;

  const actions = readOperationActions(data);
  if (element.actionSlot !== undefined) {
    const code = actions[element.actionSlot];
    return Boolean(code && resolveBehaviorIconUrl(element.actionIconRules, code));
  }

  if (actions.length > 0) {
    return actions.some((code) => resolveBehaviorIconUrl(element.actionIconRules, code));
  }

  return Boolean(resolveActionIconUrl(element.actionIconRules, {}, data, data));
}

export function activeBehaviorIconCount(
  element: VehicleBehaviorElement,
  data: Record<string, unknown> | null,
): number {
  const actions = readOperationActions(data);
  if (element.actionSlot !== undefined) {
    const code = actions[element.actionSlot];
    return code && resolveBehaviorIconUrl(element.actionIconRules, code) ? 1 : 0;
  }
  return actions.filter((code) => resolveBehaviorIconUrl(element.actionIconRules, code)).length;
}
