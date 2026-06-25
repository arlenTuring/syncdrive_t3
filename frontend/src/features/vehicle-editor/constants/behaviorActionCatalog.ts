import { resolveDashboardIconUrl } from '../../dashboard/constants/iconLibrary';
import type { RouteActionIconRule } from '../../dashboard/types';

export interface VehicleBehaviorActionDef {
  code: string;
  label: string;
  iconFile: string;
}

/** 與 public/vehicle-editor/behaviors/ 內 SVG 一一對應 */
export const VEHICLE_BEHAVIOR_ACTION_CATALOG: VehicleBehaviorActionDef[] = [
  { code: 'enter', label: '進站', iconFile: 'behaviors/enter.svg' },
  { code: 'exit', label: '出站', iconFile: 'behaviors/exit.svg' },
  { code: 'music', label: '音樂', iconFile: 'behaviors/music.svg' },
  { code: 'door_open', label: '開門', iconFile: 'behaviors/door_open.svg' },
  { code: 'door_close', label: '關門', iconFile: 'behaviors/door_close.svg' },
  { code: 'signal', label: '號誌', iconFile: 'behaviors/traffic_light.svg' },
  { code: 'alert', label: '告警', iconFile: 'behaviors/warning.svg' },
  { code: 'dispatch', label: '調度', iconFile: 'behaviors/dispatch.svg' },
  { code: 'charging', label: '充電', iconFile: 'behaviors/charging.svg' },
  { code: 'wash', label: '洗車', iconFile: 'behaviors/wash.svg' },
  { code: 'maintenance', label: '保養', iconFile: 'behaviors/maintain.svg' },
  { code: 'repair', label: '維修', iconFile: 'behaviors/repair.svg' },
  { code: 'parking', label: '臨停', iconFile: 'behaviors/park.svg' },
];

const LEGACY_ICON_TO_BEHAVIOR: Record<string, string> = {
  'music.png': 'behaviors/music.svg',
  'door-open.png': 'behaviors/door_open.svg',
  'door_close.png': 'behaviors/door_close.svg',
  'door-open': 'behaviors/door_open.svg',
  'door_close.svg': 'behaviors/door_close.svg',
  'door-close.png': 'behaviors/door_close.svg',
  'signal.png': 'behaviors/traffic_light.svg',
  'alert.png': 'behaviors/warning.svg',
  'dispatch.png': 'behaviors/dispatch.svg',
  'charging.png': 'behaviors/charging.svg',
  'wash.png': 'behaviors/wash.svg',
  'maintenance.png': 'behaviors/maintain.svg',
  'repair.png': 'behaviors/repair.svg',
  'parking.png': 'behaviors/park.svg',
  'enter.png': 'behaviors/enter.svg',
  'exit.png': 'behaviors/exit.svg',
};

export function migrateBehaviorIconFile(iconFile: string): string {
  const v = iconFile.trim();
  if (!v) return v;
  if (v.startsWith('behaviors/')) return v;
  const base = v.split('/').pop() ?? v;
  return LEGACY_ICON_TO_BEHAVIOR[base] ?? LEGACY_ICON_TO_BEHAVIOR[v] ?? v;
}

export function buildVehicleBehaviorActionRules(
  sourceVarKey = 'operation_action',
): RouteActionIconRule[] {
  return VEHICLE_BEHAVIOR_ACTION_CATALOG.map((a, i) => ({
    id: `op-${a.code}`,
    label: a.label,
    sourceVarKey,
    matchOp: 'eq' as const,
    threshold: a.code,
    iconFile: a.iconFile,
    priority: i,
  }));
}

/** 編輯時預設顯示第一條規則圖示，方便拖曳定位 */
export function defaultBehaviorIconUrl(rules: RouteActionIconRule[] | undefined): string | null {
  const sorted = [...(rules ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const first = sorted.find((r) => r.iconFile?.trim());
  if (first) {
    const url = resolveDashboardIconUrl(first.iconFile);
    if (url) return url;
  }
  const catalog = VEHICLE_BEHAVIOR_ACTION_CATALOG[0];
  return catalog ? resolveDashboardIconUrl(catalog.iconFile) : null;
}

/** 編輯／示意：依 actionSlot 或第一條規則選代表圖示 */
export function behaviorEditPreviewUrl(
  rules: RouteActionIconRule[] | undefined,
  actionSlot?: number,
): string | null {
  const sorted = [...(rules ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  if (actionSlot !== undefined) {
    const rule = sorted[actionSlot] ?? sorted.find((r) => r.iconFile?.trim());
    if (rule?.iconFile?.trim()) {
      const url = resolveDashboardIconUrl(rule.iconFile);
      if (url) return url;
    }
  }
  return defaultBehaviorIconUrl(rules);
}

export function migrateBehaviorActionRules(
  rules: RouteActionIconRule[] | undefined,
): RouteActionIconRule[] {
  if (!rules?.length) return buildVehicleBehaviorActionRules();
  return rules.map((rule) => ({
    ...rule,
    iconFile: migrateBehaviorIconFile(rule.iconFile),
  }));
}
