import type { RouteProgressWidget, RouteStation } from '../types';

function readNum(
  key: string | undefined,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  mqttPayload?: Record<string, unknown> | null,
): number | undefined {
  if (!key) return undefined;
  const v =
    mqttPayload?.[key] ??
    variables[key] ??
    sqlRow?.[key];
  return num(v);
}

function num(n: unknown): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const v = Number(n);
  return Number.isNaN(v) ? undefined : v;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

type CurrentLeg = {
  target_station_id?: unknown;
  eta_seconds?: unknown;
  distance_to_target_m?: unknown;
};

/** 依協議 current_leg.eta_seconds：首次為該段最大值，之後依差值算進度 */
const legEtaMaxCache = new Map<string, number>();

function legEtaCacheKey(mqttPayload: Record<string, unknown>, leg: CurrentLeg): string | null {
  const vehicle = mqttPayload.vehicle_code ?? mqttPayload.vehicleCode;
  const order = mqttPayload.order_id;
  const target = leg.target_station_id;
  if (!vehicle || !order || !target) return null;
  return `${String(vehicle)}|${String(order)}|${String(target)}`;
}

function routeProgressFromCurrentLeg(
  mqttPayload: Record<string, unknown>,
  leg: CurrentLeg,
): number | undefined {
  const eta = num(leg.eta_seconds);
  const target = String(leg.target_station_id ?? '').trim();
  if (eta === undefined || !target) return undefined;

  const key = legEtaCacheKey(mqttPayload, leg);
  if (!key) return undefined;

  const prevMax = legEtaMaxCache.get(key) ?? 0;
  const maxEta = Math.max(prevMax, eta);
  legEtaMaxCache.set(key, maxEta);
  if (maxEta <= 0) return target === 'T3' ? 50 : 100;

  const legFraction = clamp((maxEta - eta) / maxEta, 0, 1);
  if (target === 'T3') {
    if (eta === 0) return 50;
    return clamp(Math.round(legFraction * 50), 0, 50);
  }
  if (eta === 0) return 100;
  return clamp(Math.round(50 + legFraction * 50), 50, 100);
}

/** 從 MQTT operation/update 讀取路線總進度 0–100（優先 current_leg.eta_seconds） */
export function readMqttRouteProgress(
  rawProgress: unknown,
  mqttPayload?: Record<string, unknown> | null,
): number | undefined {
  if (!mqttPayload) {
    const v = num(rawProgress);
    return v === undefined ? undefined : clamp(v, 0, 100);
  }

  const leg = mqttPayload.current_leg;
  if (leg && typeof leg === 'object') {
    const fromLeg = routeProgressFromCurrentLeg(mqttPayload, leg as CurrentLeg);
    if (fromLeg !== undefined) return fromLeg;
  }

  const fromPath = num(rawProgress);
  if (fromPath !== undefined) return clamp(fromPath, 0, 100);

  const stored = num(mqttPayload.route_progress);
  if (stored !== undefined) return clamp(stored, 0, 100);

  return undefined;
}

/**
 * 依等距站點錨點與區段剩餘 %／總進度，計算車輛在軌道上的 0–100 位置。
 */
export function resolveVehicleTrackPercent(
  stations: RouteStation[],
  widget: RouteProgressWidget,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  rawProgress: unknown,
  mqttPayload?: Record<string, unknown> | null,
): number {
  const n = stations.length;
  if (n === 0) return 0;
  if (n === 1) return stations[0].value;

  const mqttProgress = readMqttRouteProgress(rawProgress, mqttPayload);
  if (mqttPayload !== null && mqttProgress !== undefined) {
    return mqttProgress;
  }

  const segIdx = readNum(
    widget.segmentIndexVarKey ?? 'segment_index',
    variables,
    sqlRow,
    mqttPayload,
  );
  const segRemain = readNum(
    widget.segmentRemainPctVarKey ?? 'segment_remain_pct',
    variables,
    sqlRow,
    mqttPayload,
  );

  if (segIdx !== undefined && segRemain !== undefined) {
    const i = clamp(Math.floor(segIdx), 0, n - 2);
    const a = stations[i].value;
    const b = stations[i + 1].value;
    const t = 1 - clamp(segRemain, 0, 100) / 100;
    return clamp(a + t * (b - a), 0, 100);
  }

  for (let i = 1; i < n; i++) {
    const r = stations[i].remainPct;
    if (r !== undefined && r > 0 && r < 100) {
      const a = stations[i - 1].value;
      const b = stations[i].value;
      const t = 1 - r / 100;
      return clamp(a + t * (b - a), 0, 100);
    }
  }

  const parsed = num(rawProgress);
  if (parsed !== undefined) {
    return clamp(parsed, 0, 100);
  }

  return 0;
}
