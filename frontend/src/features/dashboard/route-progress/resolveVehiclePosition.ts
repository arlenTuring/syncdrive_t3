import type { RouteProgressWidget, RouteStation } from '../types';

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
  leg_eta_max?: unknown;
};

function stationAnchor(stations: RouteStation[], target: string): number | undefined {
  const hit = stations.find((s) => s.name === target);
  return hit?.value;
}

function previousStationAnchor(stations: RouteStation[], target: string): number {
  const idx = stations.findIndex((s) => s.name === target);
  if (idx <= 0) return stations[0]?.value ?? 0;
  return stations[idx - 1].value;
}

/**
 * 當前 leg 進度：僅在「上一站 → current_leg.target」區段內移動。
 * leg_eta_max → 0 表示完成本段 100%，車輛落在目標站錨點上（非整條路 0–100）。
 */
export function routeProgressFromCurrentLeg(
  leg: CurrentLeg,
  stations: RouteStation[] = [],
): number | undefined {
  const eta = num(leg.eta_seconds);
  const target = String(leg.target_station_id ?? '').trim();
  if (eta === undefined || !target || stations.length < 2) return undefined;

  const targetAnchor = stationAnchor(stations, target);
  if (targetAnchor === undefined) return undefined;
  const prevAnchor = previousStationAnchor(stations, target);
  const span = targetAnchor - prevAnchor;
  if (span <= 0) return targetAnchor;

  if (eta <= 0) {
    return targetAnchor;
  }

  const legEtaMax = num(leg.leg_eta_max);
  if (legEtaMax === undefined || legEtaMax <= 0) {
    return prevAnchor;
  }

  const legComplete = clamp(1 - eta / legEtaMax, 0, 1);
  return clamp(prevAnchor + legComplete * span, 0, 100);
}

/** 班次卡進度：僅來自 MQTT current_leg（不用 SQL／route_progress） */
export function readMqttRouteProgress(
  mqttPayload?: Record<string, unknown> | null,
  stations: RouteStation[] = [],
): number | undefined {
  if (!mqttPayload) return undefined;

  const leg = mqttPayload.current_leg;
  if (!leg || typeof leg !== 'object') return undefined;

  return routeProgressFromCurrentLeg(leg as CurrentLeg, stations);
}

/**
 * 非班次卡／編輯預覽：可讀 widget 綁定值；班次卡請用 readMqttRouteProgress + useAnimatedTrackPercent(mqttOnly)。
 */
export function resolveVehicleTrackPercent(
  stations: RouteStation[],
  _widget: RouteProgressWidget,
  _variables: Record<string, unknown>,
  _sqlRow: Record<string, unknown> | null,
  rawProgress: unknown,
  mqttPayload?: Record<string, unknown> | null,
): number {
  const n = stations.length;
  if (n === 0) return 0;
  if (n === 1) return stations[0].value;

  const fromMqtt = mqttPayload ? readMqttRouteProgress(mqttPayload, stations) : undefined;
  if (fromMqtt !== undefined) return fromMqtt;

  const parsed = num(rawProgress);
  if (parsed !== undefined) return clamp(parsed, 0, 100);

  return stations[0].value;
}
