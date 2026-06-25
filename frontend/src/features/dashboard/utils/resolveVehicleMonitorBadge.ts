import type { VariableMap } from '../VariableContext';

/** 正線班次：D/U + 4 位時分（營運任務狀態協議 §三） */
const SHIFT_TRIP_CODE_RE = /^[DU]\d{4}$/;

export const ORDER_PRIORITY_LINE = 50;
export const ORDER_PRIORITY_MAINT = 40;

const ACTIVE_MAINLINE_STATUS = new Set(['PROCESSING']);
const ACTIVE_MAINT_STATUS = new Set(['PENDING', 'PROCESSING']);

export type VehicleMonitorBadgeKind = 'mainline' | 'maintenance' | 'none';

export interface VehicleMonitorBadge {
  label: string;
  bg: string;
  color: string;
  kind: VehicleMonitorBadgeKind;
}

export function isShiftTripCode(code: unknown): boolean {
  if (code === null || code === undefined) return false;
  return SHIFT_TRIP_CODE_RE.test(String(code).trim());
}

function readStr(source: Record<string, unknown> | VariableMap | null | undefined, key: string): string {
  if (!source) return '';
  const v = source[key];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function readNum(source: Record<string, unknown> | VariableMap | null | undefined, key: string): number | null {
  const raw = readStr(source, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function mergeOperationContext(
  variables: VariableMap,
  operation?: Record<string, unknown> | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    priority_level: variables.priority_level,
    line_kind: variables.line_kind,
    order_status: variables.order_status,
    trip_code: variables.trip_code,
    maint_type_label: variables.maint_type_label,
    maint_type_bg: variables.maint_type_bg,
    maint_type_color: variables.maint_type_color,
    trip_badge_bg: variables.trip_badge_bg,
    trip_badge_color: variables.trip_badge_color,
    badge_label: variables.badge_label,
    badge_kind: variables.badge_kind,
    vehicle_phase: variables.vehicle_phase,
  };
  if (!operation) return base;
  for (const [key, value] of Object.entries(operation)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    base[key] = value;
  }
  return base;
}

function orderStatus(ctx: Record<string, unknown>): string {
  return readStr(ctx, 'order_status') || readStr(ctx, 'status');
}

function isMainlineOrder(ctx: Record<string, unknown>): boolean {
  const kind = readStr(ctx, 'line_kind').toUpperCase();
  if (kind === 'MAINLINE') return true;
  const pri = readNum(ctx, 'priority_level');
  return pri === ORDER_PRIORITY_LINE;
}

function isMaintenanceOrder(ctx: Record<string, unknown>): boolean {
  const kind = readStr(ctx, 'line_kind').toUpperCase();
  if (kind === 'MAINTENANCE') return true;
  const pri = readNum(ctx, 'priority_level');
  return pri === ORDER_PRIORITY_MAINT;
}

const EMPTY_BADGE: VehicleMonitorBadge = {
  label: '',
  bg: '',
  color: '',
  kind: 'none',
};

/**
 * 車輛狀態卡右上角：優先 operation/update（營運任務協議），SQL 變數為後備。
 * 正線 → trip_code；整備 → maint_type_label（來自訂單／任務資料，不在此寫死文案）。
 */
const ACTIVE_MAINLINE_PHASES = new Set(['TRANSITING', 'DWELLING', 'PRE_DEPARTURE']);

export function resolveVehicleMonitorBadge(
  variables: VariableMap,
  sources: { operation?: Record<string, unknown> | null } = {},
): VehicleMonitorBadge {
  const ctx = mergeOperationContext(variables, sources.operation);
  const status = orderStatus(ctx);
  const phase = readStr(ctx, 'vehicle_phase').toUpperCase();
  const trip = readStr(ctx, 'trip_code') || readStr(ctx, 'badge_label');

  // 營運任務 MQTT：執行階段 + 有效班次代碼（協議 trip_code）
  if (isShiftTripCode(trip) && ACTIVE_MAINLINE_PHASES.has(phase)) {
    return {
      label: trip,
      bg: readStr(ctx, 'trip_badge_bg') || '#7e57c2',
      color: readStr(ctx, 'trip_badge_color') || '#f3e8ff',
      kind: 'mainline',
    };
  }

  if (isMainlineOrder(ctx) && ACTIVE_MAINLINE_STATUS.has(status)) {
    if (isShiftTripCode(trip)) {
      return {
        label: trip,
        bg: readStr(ctx, 'trip_badge_bg') || '#7e57c2',
        color: readStr(ctx, 'trip_badge_color') || '#f3e8ff',
        kind: 'mainline',
      };
    }
  }

  if (isMaintenanceOrder(ctx) && ACTIVE_MAINT_STATUS.has(status)) {
    const label = readStr(ctx, 'maint_type_label') || readStr(ctx, 'badge_label');
    if (label && !isShiftTripCode(label)) {
      return {
        label,
        bg: readStr(ctx, 'maint_type_bg') || readStr(ctx, 'trip_badge_bg') || '#422006',
        color: readStr(ctx, 'maint_type_color') || readStr(ctx, 'trip_badge_color') || '#fdba74',
        kind: 'maintenance',
      };
    }
  }

  const kind = readStr(ctx, 'badge_kind');
  const fallback = readStr(ctx, 'badge_label');
  if (fallback) {
    if (kind === 'mainline' && isShiftTripCode(fallback)) {
      return {
        label: fallback,
        bg: readStr(ctx, 'trip_badge_bg') || '#7e57c2',
        color: readStr(ctx, 'trip_badge_color') || '#f3e8ff',
        kind: 'mainline',
      };
    }
    if (kind === 'maintenance' && !isShiftTripCode(fallback)) {
      return {
        label: fallback,
        bg: readStr(ctx, 'maint_type_bg') || '#422006',
        color: readStr(ctx, 'maint_type_color') || '#fdba74',
        kind: 'maintenance',
      };
    }
  }

  return EMPTY_BADGE;
}

/** @deprecated 請改用 resolveVehicleMonitorBadge */
export function resolveShiftBadgeLabel(
  variables: VariableMap,
  sources: {
    telemetry?: Record<string, unknown> | null;
    operation?: Record<string, unknown> | null;
    badgeField?: string;
  } = {},
): string {
  return resolveVehicleMonitorBadge(variables, { operation: sources.operation }).label;
}
