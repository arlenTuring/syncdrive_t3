import type { RouteActionIconRule } from '../types';
import { VEHICLE_OPERATION_ACTION_CATALOG } from './actionCatalog';

/** 依設計稿作動行為產生的範例對應（變數 operation_action = 代碼） */
export function buildCatalogActionRules(
  sourceVarKey = 'operation_action',
): RouteActionIconRule[] {
  return VEHICLE_OPERATION_ACTION_CATALOG.map((a, i) => ({
    id: `op-${a.code}`,
    label: a.label,
    sourceVarKey,
    matchOp: 'eq' as const,
    threshold: a.code,
    iconFile: a.iconFile,
    priority: i,
  }));
}

/** 含代碼對應 + 故障／延誤等額外條件 */
export const DEFAULT_VEHICLE_OPERATION_ACTION_RULES: RouteActionIconRule[] = [
  ...buildCatalogActionRules('operation_action'),
  {
    id: 'fault-flag',
    label: '故障旗標',
    sourceVarKey: 'is_alert',
    matchOp: 'present',
    iconFile: 'alert.png',
    priority: 100,
  },
  {
    id: 'delay',
    label: '延誤分鐘',
    sourceVarKey: 'delay_minutes',
    matchOp: 'gte',
    threshold: 1,
    iconFile: 'dispatch.png',
    priority: 90,
  },
];
