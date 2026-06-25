import { useEffect, useRef, useState } from 'react';
import type { RouteProgressWidget, RouteStation } from '../types';
import { readMqttRouteProgress, resolveVehicleTrackPercent } from './resolveVehiclePosition';
import { readOrderStatus } from './orderStatus';

export function mqttPayloadIsFresh(
  payload: Record<string, unknown> | null,
  maxAgeMs = 2500,
): boolean {
  if (!payload) return false;
  const ts = Number(payload.timestamp ?? payload.updated_at);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Date.now() - ts <= maxAgeMs;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** 由 eta_remain（00:50 / 00:30:00）推算區段行進秒數 */
export function parseEtaToSeconds(eta: unknown): number | undefined {
  if (eta === null || eta === undefined || eta === '') return undefined;
  const parts = String(eta).trim().split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

export function trackPercentFromSegment(
  stations: RouteStation[],
  segmentIndex: number,
  segmentRemainPct: number,
): number {
  const n = stations.length;
  if (n < 2) return stations[0]?.value ?? 0;
  const i = clamp(Math.floor(segmentIndex), 0, n - 2);
  const a = stations[i].value;
  const b = stations[i + 1].value;
  const t = 1 - clamp(segmentRemainPct, 0, 100) / 100;
  return clamp(a + t * (b - a), 0, 100);
}

/** MQTT 即時進度：每幀緩慢逼近目標，避免跳動 */
function useSmoothMqttProgress(
  mqttTarget: number | undefined,
  hasLiveMqtt: boolean,
  rowKey: string,
  fallback: number,
): number {
  const [display, setDisplay] = useState(mqttTarget ?? fallback);
  const currentRef = useRef(mqttTarget ?? fallback);
  const targetRef = useRef(mqttTarget ?? fallback);

  useEffect(() => {
    const seed = mqttTarget ?? fallback;
    currentRef.current = seed;
    targetRef.current = seed;
    setDisplay(seed);
  }, [rowKey, mqttTarget, fallback]);

  useEffect(() => {
    if (!hasLiveMqtt || mqttTarget === undefined) return;
    targetRef.current = mqttTarget;
  }, [hasLiveMqtt, mqttTarget]);

  useEffect(() => {
    if (!hasLiveMqtt) return;

    let raf = 0;
    const SMOOTH = 0.055;

    const tick = () => {
      const target = targetRef.current;
      let cur = currentRef.current;
      const delta = target - cur;
      if (Math.abs(delta) < 0.03) {
        cur = target;
      } else {
        cur += delta * SMOOTH;
      }
      currentRef.current = cur;
      setDisplay(cur);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasLiveMqtt, rowKey]);

  return hasLiveMqtt && mqttTarget !== undefined ? display : fallback;
}

/** SQL 輪詢進度：在兩次查詢之間平滑補間 */
function useSmoothSqlProgress(
  target: number,
  enabled: boolean,
  rowKey: string,
): number {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const targetRef = useRef(target);

  useEffect(() => {
    currentRef.current = target;
    targetRef.current = target;
    setDisplay(target);
  }, [rowKey]);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (!enabled) {
      setDisplay(target);
      currentRef.current = target;
      return;
    }

    let raf = 0;
    const SMOOTH = 0.08;

    const tick = () => {
      const goal = targetRef.current;
      let cur = currentRef.current;
      const delta = goal - cur;
      if (Math.abs(delta) < 0.05) {
        cur = goal;
      } else {
        cur += delta * SMOOTH;
      }
      currentRef.current = cur;
      setDisplay(cur);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, rowKey]);

  return enabled ? display : target;
}

/**
 * 正線／整備軌道進度：
 * - PENDING：固定於路線起點
 * - FAULTED：凍結位置
 * - PROCESSING：MQTT current_leg.eta_seconds 優先
 */
export function useAnimatedTrackPercent(
  stations: RouteStation[],
  widget: RouteProgressWidget,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  rawProgress: unknown,
  mqttPayload: Record<string, unknown> | null,
): number {
  const staticPercent = resolveVehicleTrackPercent(
    stations,
    widget,
    variables,
    sqlRow,
    rawProgress,
    mqttPayload,
  );

  const orderStatus = readOrderStatus(variables, sqlRow, mqttPayload);
  const isPending = orderStatus === 'PENDING';
  const isFaulted = orderStatus === 'FAULTED';
  const isProcessing = orderStatus === 'PROCESSING';

  const mqttFresh = mqttPayloadIsFresh(mqttPayload);
  const mqttTarget = mqttFresh ? readMqttRouteProgress(rawProgress, mqttPayload) : undefined;
  const hasLiveMqttProgress =
    isProcessing
    && mqttPayload !== null
    && mqttTarget !== undefined
    && mqttFresh;

  const rowKey = String(variables.shift_key ?? variables.vehicle_code ?? 'default');
  const pendingOrigin = isPending && stations.length >= 2
    ? trackPercentFromSegment(stations, 0, 100)
    : staticPercent;

  const smoothMqttPercent = useSmoothMqttProgress(
    mqttTarget,
    hasLiveMqttProgress,
    rowKey,
    pendingOrigin,
  );

  const smoothSqlPercent = useSmoothSqlProgress(
    staticPercent,
    isProcessing && !hasLiveMqttProgress && !mqttFresh,
    rowKey,
  );

  if (isPending && stations.length >= 2) {
    return trackPercentFromSegment(stations, 0, 100);
  }
  if (isFaulted) {
    return staticPercent;
  }
  if (hasLiveMqttProgress) {
    return smoothMqttPercent;
  }
  if (isProcessing && !mqttFresh) {
    return smoothSqlPercent;
  }
  return staticPercent;
}
