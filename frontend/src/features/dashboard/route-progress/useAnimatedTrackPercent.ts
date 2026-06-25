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
  const rafRef = useRef(0);

  // 換卡（rowKey 變）時重置基準，不在每次 mqttTarget 變動就 snap
  useEffect(() => {
    const seed = mqttTarget ?? fallback;
    currentRef.current = seed;
    targetRef.current = seed;
    setDisplay(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  // 目標更新時，只在「需要動畫」時啟動 rAF；到達目標即停止重排，避免常駐 60fps 迴圈
  useEffect(() => {
    if (!enabled || mqttTarget === undefined) return;
    targetRef.current = mqttTarget;
    if (rafRef.current !== 0) return; // 已有動畫在跑

    const SMOOTH = 0.12;
    const tick = () => {
      const target = targetRef.current;
      const delta = target - currentRef.current;
      if (Math.abs(delta) < 0.05) {
        currentRef.current = target;
        setDisplay(target);
        rafRef.current = 0; // 抵達目標 → 停止迴圈（不再重排 rAF）
        return;
      }
      currentRef.current += delta * SMOOTH;
      setDisplay(currentRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, mqttTarget]);

  // 卸載時清掉殘留 rAF
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

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
