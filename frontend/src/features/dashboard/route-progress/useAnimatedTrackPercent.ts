import { useEffect, useRef, useState } from 'react';
import type { RouteProgressWidget, RouteStation } from '../types';
import { readMqttRouteProgress, routeProgressFromCurrentLeg } from './resolveVehiclePosition';
import { readOrderStatus } from './orderStatus';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import { extrapolateLegEtaSeconds } from '../utils/simClock';
import { useSimClockFrame } from '../utils/simClockFrame';
import {
  advanceLegProgress,
  legReportFromPayload,
  parseLegDistanceMax,
  recallLegProgress,
  rememberLegProgress,
  type LegProgressState,
} from './legProgress';

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

function readMqttRouteProgressSim(
  mqttPayload: Record<string, unknown> | null,
  stations: RouteStation[],
  speedMultiplier: number,
  playing: boolean,
): number | undefined {
  if (!mqttPayload?.current_leg || typeof mqttPayload.current_leg !== 'object') {
    return undefined;
  }
  const leg = mqttPayload.current_leg as Record<string, unknown>;
  const eta = extrapolateLegEtaSeconds(mqttPayload, speedMultiplier, playing);
  return routeProgressFromCurrentLeg({ ...leg, eta_seconds: eta }, stations);
}

/** 模擬播放：依 sim 時鐘連續推進進度（共用 tick，非每卡獨立 rAF） */
function useSimClockTrackProgress(
  mqttPayload: Record<string, unknown> | null,
  stations: RouteStation[],
  enabled: boolean,
  fallback: number,
  speedMultiplier: number,
  playing: boolean,
): number {
  useSimClockFrame(enabled && playing);
  if (!enabled) return fallback;
  return readMqttRouteProgressSim(mqttPayload, stations, speedMultiplier, playing) ?? fallback;
}

function useSmoothMqttProgress(
  mqttTarget: number | undefined,
  enabled: boolean,
  rowKey: string,
  fallback: number,
  speedMultiplier: number,
): number {
  const [display, setDisplay] = useState(mqttTarget ?? fallback);
  const currentRef = useRef(mqttTarget ?? fallback);
  const targetRef = useRef(mqttTarget ?? fallback);
  const rafRef = useRef(0);
  const smoothFactor = Math.min(0.4, 0.12 * Math.max(1, speedMultiplier));

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

    const tick = () => {
      const target = targetRef.current;
      const delta = target - currentRef.current;
      if (Math.abs(delta) < 0.05) {
        currentRef.current = target;
        setDisplay(target);
        rafRef.current = 0; // 抵達目標 → 停止迴圈（不再重排 rAF）
        return;
      }
      currentRef.current += delta * smoothFactor;
      setDisplay(currentRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, mqttTarget, smoothFactor]);

  // 卸載時清掉殘留 rAF
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  return enabled && mqttTarget !== undefined ? display : fallback;
}

export type AnimatedTrackPercentOptions = {
  /** 班次卡：以單號＋段落推進（legProgress.ts），不在 MQTT 與 SQL 兩套算法之間切換 */
  mqttOnly?: boolean;
  /** 班次卡：這台車最新的 operation/update（不先濾新鮮度——順序與單號由 legProgress 判斷） */
  rawShiftPayload?: Record<string, unknown> | null;
};

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 班次卡這張單目前的段落進度（純計算＋依單號記住）；沒有單號時回 null */
export function shiftCardLegProgress(
  orderId: string,
  stations: RouteStation[],
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  rawPayload: Record<string, unknown> | null,
): LegProgressState | null {
  if (!orderId || stations.length === 0) return null;
  const next = advanceLegProgress(recallLegProgress(orderId), {
    orderId,
    stations,
    report: legReportFromPayload(rawPayload),
    backendLegDistanceMax: parseLegDistanceMax(sqlRow?.leg_distance_max_m ?? variables.leg_distance_max_m),
    sql: {
      segmentIndex: numOrNull(sqlRow?.segment_index ?? variables.segment_index),
      remainPct: numOrNull(sqlRow?.segment_remain_pct ?? variables.segment_remain_pct),
    },
  });
  return rememberLegProgress(next);
}

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
  const { speedMultiplier, running, paused, transportPaused } = useDemoSimulationPlayback();
  const simPlaying = running && !paused && !transportPaused;
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

  // 班次卡：同一張單、同一段的距離進度（見 legProgress.ts）；不再用 ETA 比值，也不在 SQL／MQTT 間換算法
  const shiftOrderId = mqttOnly ? String(variables.shift_key ?? '').trim() : '';
  const legState = shiftOrderId
    ? shiftCardLegProgress(shiftOrderId, stations, variables, sqlRow, options?.rawShiftPayload ?? mqttPayload)
    : null;
  const legSmoothed = useSmoothMqttProgress(
    legState?.percent,
    legState !== null && isProcessing,
    shiftOrderId || rowKey,
    legState?.percent ?? origin,
    speedMultiplier,
  );

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

  const simClockPercent = useSimClockTrackProgress(
    mqttPayload,
    stations,
    hasLiveMqtt && simPlaying,
    lastMqttRef.current ?? origin,
    speedMultiplier,
    simPlaying,
  );

  const smoothMqttPercent = useSmoothMqttProgress(
    mqttTarget,
    hasLiveMqtt && !simPlaying,
    rowKey,
    lastMqttRef.current ?? origin,
    speedMultiplier,
  );

  if (isPending) {
    return origin;
  }
  if (legState) {
    // 故障：停在最後有效位置；執行中：平滑移到段落進度（換單時 rowKey＝單號，重新起算）
    return isProcessing ? legSmoothed : legState.percent;
  }
  if (isFaulted) {
    return lastMqttRef.current ?? origin;
  }
  if (hasLiveMqtt) {
    return simPlaying ? simClockPercent : smoothMqttPercent;
  }
  if (holdMqtt) {
    return lastMqttRef.current!;
  }
  if (mqttOnly) {
    const segIdx = Number(sqlRow?.segment_index ?? variables.segment_index ?? 0);
    const segRem = Number(sqlRow?.segment_remain_pct ?? variables.segment_remain_pct ?? 0);
    if (stations.length >= 2 && Number.isFinite(segIdx) && Number.isFinite(segRem)) {
      return trackPercentFromSegment(stations, segIdx, segRem);
    }
    return origin;
  }
  return mqttTarget ?? origin;
}
