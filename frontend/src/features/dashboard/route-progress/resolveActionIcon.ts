import type { RouteActionIconRule, RouteActionMatchOp } from '../types';
import { getByPath } from '../utils/jsonPath';
import { resolveDashboardIconUrl } from '../constants/iconLibrary';

type TaskGroupRow = { task_name?: string; status?: string };

/** 協議 task_group：PLATFORM_DOCKING / STATION_DEPARTURE IN_PROGRESS → 進出站圖示 */
function resolveIconFromTaskGroup(
  mqttPayload: Record<string, unknown> | null,
): string | null {
  if (!mqttPayload) return null;
  const tasks = mqttPayload.task_group;
  if (!Array.isArray(tasks)) return null;
  const active = (tasks as TaskGroupRow[]).filter(
    (t) => String(t?.status ?? '').toUpperCase() === 'IN_PROGRESS',
  );
  if (active.some((t) => t.task_name === 'STATION_DEPARTURE')) {
    return resolveDashboardIconUrl('exit.png');
  }
  if (active.some((t) => t.task_name === 'PLATFORM_DOCKING')) {
    return resolveDashboardIconUrl('enter.png');
  }
  return null;
}

function ruleValue(
  rule: RouteActionIconRule,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  mqttPayload: Record<string, unknown> | null,
): unknown {
  if (mqttPayload) {
    const fromMqtt =
      getByPath(mqttPayload, rule.sourceVarKey) ?? mqttPayload[rule.sourceVarKey];
    if (fromMqtt !== undefined && fromMqtt !== null && String(fromMqtt).trim() !== '') {
      return fromMqtt;
    }
  }
  return variables[rule.sourceVarKey] ?? sqlRow?.[rule.sourceVarKey];
}

function matches(op: RouteActionMatchOp, raw: unknown, threshold?: string | number): boolean {
  if (op === 'present') {
    if (raw === null || raw === undefined) return false;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return !Number.isNaN(raw);
    return String(raw).trim() !== '';
  }
  const a = String(raw ?? '');
  const b = String(threshold ?? '');
  if (op === 'eq') return a === b;
  const na = Number(raw);
  const nb = Number(threshold);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  if (op === 'gte') return na >= nb;
  if (op === 'gt') return na > nb;
  return false;
}

/** 回傳第一個命中的動作圖示 URL（task_group 進出站 → MQTT → 群組變數 → SQL） */
export function resolveActionIconUrl(
  rules: RouteActionIconRule[] | undefined,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  mqttPayload?: Record<string, unknown> | null,
): string | null {
  const mqtt = mqttPayload ?? null;
  const fromTaskGroup = resolveIconFromTaskGroup(mqtt);
  if (fromTaskGroup) return fromTaskGroup;

  if (!rules?.length) return null;
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of sorted) {
    if (!rule.iconFile?.trim()) continue;
    const raw = ruleValue(rule, variables, sqlRow, mqtt);
    if (matches(rule.matchOp, raw, rule.threshold)) {
      return resolveDashboardIconUrl(rule.iconFile);
    }
  }
  return null;
}
