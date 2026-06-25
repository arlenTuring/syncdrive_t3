import { useEffect, useRef, useState } from 'react';
import type { RouteProgressWidget, RouteStation } from '../types';
import { readMqttRouteProgress } from './resolveVehiclePosition';
import { readOrderStatus } from './orderStatus';

export function mqttPayloadIsFresh(
  payload: Record<string, unknown> | null,
  maxAgeMs = 4000,
): boolean {
  if (!payload) return false;
  const ts = Number(payload.timestamp ?? payload.updated_at);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Date.now() - ts <= maxAgeMs;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
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

function useSmoothMqttProgress(
  mqttTarget: number | undefined,
  enabled: boolean,
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
    if (!enabled || mqttTarget === undefined) return;
    targetRef.current = mqttTarget;
  }, [enabled, mqttTarget]);

  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled, rowKey]);

  return enabled && mqttTarget !== undefined ? display : fallback;
}

export type AnimatedTrackPercentOptions = {
  /** 班次卡：僅 MQTT current_leg，不讀 SQL segment／route_progress */
  mqttOnly?: boolean;
};

/**
 * 正線／整備軌道進度：
 * - PENDING：路線起點
 * - PROCESSING：MQTT current_leg（每段 eta 各自 0→leg_eta_max）
 * - 班次卡 mqttOnly：MQTT 短暫中斷時保留上一筆位置，不回退 SQL
 */
export function useAnimatedTrackPercent(
  stations: RouteStation[],
  _widget: RouteProgressWidget,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  _rawProgress: unknown,
  mqttPayload: Record<string, unknown> | null,
  options?: AnimatedTrackPercentOptions,
): number {
  const mqttOnly = options?.mqttOnly ?? false;
  const orderStatus = readOrderStatus(variables, sqlRow, mqttPayload);
  const isPending = orderStatus === 'PENDING';
  const isFaulted = orderStatus === 'FAULTED';
  const isProcessing = orderStatus === 'PROCESSING';

  const rowKey = String(variables.shift_key ?? variables.vehicle_code ?? 'default');
  const origin =
    stations.length >= 2
      ? trackPercentFromSegment(stations, 0, 100)
      : stations[0]?.value ?? 0;

  const mqttFresh = mqttPayloadIsFresh(mqttPayload);
  const mqttTarget = mqttPayload
    ? readMqttRouteProgress(mqttPayload, stations)
    : undefined;

  const lastMqttRef = useRef<number | undefined>(undefined);
  if (mqttTarget !== undefined) {
    lastMqttRef.current = mqttTarget;
  }

  const hasLiveMqtt =
    isProcessing
    && mqttPayload !== null
    && mqttTarget !== undefined
    && mqttFresh;

  const holdMqtt =
    mqttOnly
    && isProcessing
    && mqttTarget === undefined
    && lastMqttRef.current !== undefined;

  const smoothMqttPercent = useSmoothMqttProgress(
    mqttTarget,
    hasLiveMqtt,
    rowKey,
    lastMqttRef.current ?? origin,
  );

  if (isPending) {
    return origin;
  }
  if (isFaulted) {
    return lastMqttRef.current ?? origin;
  }
  if (hasLiveMqtt) {
    return smoothMqttPercent;
  }
  if (holdMqtt) {
    return lastMqttRef.current!;
  }
  if (mqttOnly) {
    return origin;
  }
  return mqttTarget ?? origin;
}
