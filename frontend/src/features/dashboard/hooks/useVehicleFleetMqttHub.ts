import { useEffect, useRef, useState } from 'react';
import { markVehicleSeen } from '../elements/vehicleLastSeen';
import { acquireSocket, releaseSocket } from '../elements/socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { VTMS_DEBUG_VEHICLES, VTMS_VEHICLE_POOL } from '../constants/vtmsVehiclePool';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import type { VtmsStreamKind } from '../utils/vtmsTopic';
import { vtmsRowKeyForStream } from '../utils/vtmsMqttRowKey';
import { isFleetEntryExpired, judgeFleetMessage } from '../utils/fleetMqttValidity';

const STREAMS = ['telemetry', 'operation', 'health'] as const;

/** 多久檢查一次過期（期限 5 秒，每秒看一次就夠：最慢 6 秒內移除） */
const FLEET_EXPIRY_SWEEP_MS = 1_000;

/** 後端完整重置測試資料後廣播（data-admin live-data-reset.service.ts） */
type LiveStateResetPayload = { vehicleCodes?: string[]; at?: number };

const DS_MQTT = 'default-mqtt';

const STREAM_SUFFIX: Record<VtmsStreamKind, string> = {
  telemetry: 'telemetry/update',
  operation: 'operation/update',
  health: 'health/heartbeat',
};

export type VehicleFleetMqttHub = {
  operation: Map<string, Record<string, unknown>>;
  telemetry: Map<string, Record<string, unknown>>;
  health: Map<string, Record<string, unknown>>;
  connected: boolean;
  /** 遞增 tick：訂閱端依此重讀 Map，無需每幀 clone 三份 Map */
  tick: number;
};

function createEmptyHub(): VehicleFleetMqttHub {
  return {
    operation: new Map(),
    telemetry: new Map(),
    health: new Map(),
    connected: false,
    tick: 0,
  };
}

/** 合併同一幀內多次 MQTT，上限 ~20fps，避免 11 車 × 3 stream 拖垮分頁 */
const FLEET_HUB_MIN_FLUSH_MS = 50;

/**
 * 全車隊 VTMS MQTT 集中訂閱（telemetry / operation / health）。
 * 每車每 stream 僅一條 listener，供 useMqttData 與班次卡共用。
 */
export function useVehicleFleetMqttHub(enabled: boolean): VehicleFleetMqttHub {
  /**
   * 何時該丟掉進來的 MQTT。
   *
   * <strong>不能用 paused。</strong>那個旗標是 <code>!status.running</code>——
   * 「示範模擬器沒在跑」。真實車隊從外面推 MQTT 進來時示範模擬器本來就不會跑，
   * 於是每一筆遙測都在這裡被丟掉：socket 明明收得到（實測 5 秒 172 筆），
   * hub 卻永遠是空的，圖台的車輛圖層跟著一台都沒有。
   *
   * 真正該停的只有一種情況：示範回放正在跑而且被使用者按了暫停。
   */
  const { running, transportPaused } = useDemoSimulationPlayback();
  const paused = running && transportPaused;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const [hub, setHub] = useState<VehicleFleetMqttHub>(() => createEmptyHub());
  const hubRef = useRef(hub);
  hubRef.current = hub;

  const pendingRef = useRef<Record<VtmsStreamKind, Map<string, Record<string, unknown>>>>({
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
  });
  const rowKeyRef = useRef<Record<VtmsStreamKind, Map<string, string>>>({
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
  });
  /** 每台車每個串流最後一次「有效收到」的時間（本機時鐘）；過期判斷看這個，不看連線 */
  const receivedAtRef = useRef<Record<VtmsStreamKind, Map<string, number>>>({
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
  });
  /** 上一次收下的訊息時間戳：一樣的就是 retain 重送 */
  const lastTimestampRef = useRef<Record<VtmsStreamKind, Map<string, number>>>({
    telemetry: new Map(),
    operation: new Map(),
    health: new Map(),
  });
  /** 每台車最近一次被重置的時間（後端廣播的 at）；早於它的訊息都是舊的 */
  const resetAtRef = useRef<Map<string, number>>(new Map());
  const flushRafRef = useRef(0);
  const lastFlushAtRef = useRef(0);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!enabled || !paused) return;
    pendingRef.current.telemetry.clear();
    pendingRef.current.operation.clear();
    pendingRef.current.health.clear();
    rowKeyRef.current.telemetry.clear();
    rowKeyRef.current.operation.clear();
    rowKeyRef.current.health.clear();
    dirtyRef.current = false;
    const cleared = createEmptyHub();
    cleared.connected = hubRef.current.connected;
    hubRef.current = cleared;
    setHub(cleared);
  }, [enabled, paused]);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current.telemetry.clear();
      pendingRef.current.operation.clear();
      pendingRef.current.health.clear();
      rowKeyRef.current.telemetry.clear();
      rowKeyRef.current.operation.clear();
      rowKeyRef.current.health.clear();
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      dirtyRef.current = false;
      hubRef.current.operation.clear();
      hubRef.current.telemetry.clear();
      hubRef.current.health.clear();
      hubRef.current = createEmptyHub();
      setHub(hubRef.current);
      return;
    }

    const ds = getDataSourceById(DS_MQTT);
    if (!ds || ds.type !== 'mqtt') return;

    const socket = acquireSocket(ds.backendUrl);
    const handlers: Array<{ eventName: string; handler: (payload: unknown) => void }> = [];

    const flushPending = () => {
      flushRafRef.current = 0;
      let changed = false;
      for (const stream of ['telemetry', 'operation', 'health'] as const) {
        const pending = pendingRef.current[stream];
        if (pending.size === 0) continue;
        const target = hubRef.current[stream];
        const keys = rowKeyRef.current[stream];
        for (const [code, row] of pending) {
          const key = vtmsRowKeyForStream(stream, row);
          if (keys.get(code) === key) continue;
          keys.set(code, key);
          target.set(code, row);
          changed = true;
        }
        pending.clear();
      }
      dirtyRef.current = dirtyRef.current || changed;
      if (!dirtyRef.current) return;

      const now = Date.now();
      if (now - lastFlushAtRef.current < FLEET_HUB_MIN_FLUSH_MS) {
        scheduleFlush();
        return;
      }
      lastFlushAtRef.current = now;
      dirtyRef.current = false;
      const next: VehicleFleetMqttHub = {
        operation: hubRef.current.operation,
        telemetry: hubRef.current.telemetry,
        health: hubRef.current.health,
        connected: hubRef.current.connected,
        tick: hubRef.current.tick + 1,
      };
      hubRef.current = next;
      setHub(next);
    };

    const scheduleFlush = () => {
      if (flushRafRef.current) return;
      flushRafRef.current = requestAnimationFrame(flushPending);
    };

    const onConnect = () => {
      if (hubRef.current.connected) return;
      hubRef.current = { ...hubRef.current, connected: true, tick: hubRef.current.tick + 1 };
      setHub(hubRef.current);
    };
    const onDisconnect = () => {
      if (!hubRef.current.connected) return;
      hubRef.current = { ...hubRef.current, connected: false, tick: hubRef.current.tick + 1 };
      setHub(hubRef.current);
    };
    /*
     * 過期淘汰：沒有新訊息也要移除。被移除的串流換一個新的 Map——訂閱端（班次卡合併）
     * 依 Map 身分決定要不要重算，原地刪除它不會知道。
     */
    const sweepExpired = () => {
      const now = Date.now();
      let changed = false;
      const next = { ...hubRef.current };
      for (const stream of STREAMS) {
        const target = hubRef.current[stream];
        const expired = [...target.keys()].filter((code) => isFleetEntryExpired(receivedAtRef.current[stream].get(code), now));
        if (expired.length === 0) continue;
        const fresh = new Map(target);
        for (const code of expired) {
          fresh.delete(code);
          rowKeyRef.current[stream].delete(code);
          receivedAtRef.current[stream].delete(code);
        }
        next[stream] = fresh;
        changed = true;
      }
      if (!changed) return;
      next.tick = hubRef.current.tick + 1;
      hubRef.current = next;
      setHub(next);
    };
    const sweepTimer = window.setInterval(sweepExpired, FLEET_EXPIRY_SWEEP_MS);

    /** 後端重置測試資料：所選車輛的即時資料、待處理訊息、去重紀錄全部清掉 */
    const onLiveStateReset = (payload: LiveStateResetPayload) => {
      const codes = (payload?.vehicleCodes ?? []).map((code) => String(code).toUpperCase());
      if (codes.length === 0) return;
      const at = Number(payload.at) || Date.now();
      const next = { ...hubRef.current };
      for (const stream of STREAMS) {
        const fresh = new Map(hubRef.current[stream]);
        for (const code of codes) {
          fresh.delete(code);
          pendingRef.current[stream].delete(code);
          rowKeyRef.current[stream].delete(code);
          receivedAtRef.current[stream].delete(code);
          lastTimestampRef.current[stream].delete(code);
        }
        next[stream] = fresh;
      }
      for (const code of codes) resetAtRef.current.set(code, at);
      next.tick = hubRef.current.tick + 1;
      hubRef.current = next;
      setHub(next);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('live-state/reset', onLiveStateReset);
    if (socket.connected) onConnect();

    for (const vehicleCode of [...VTMS_VEHICLE_POOL, ...VTMS_DEBUG_VEHICLES]) {
      for (const stream of ['telemetry', 'operation', 'health'] as const) {
        const topic = `v1/vtms/${vehicleCode}/${STREAM_SUFFIX[stream]}`;
        const eventName = `mqtt/${topic}`;
        const handler = (payload: unknown) => {
          if (pausedRef.current) return;
          if (!payload || typeof payload !== 'object') return;
          const row = payload as Record<string, unknown>;
          const code = String(row.vehicle_code ?? vehicleCode).toUpperCase();
          const receivedAt = Date.now();
          const verdict = judgeFleetMessage({
            payload: row,
            receivedAt,
            resetAt: resetAtRef.current.get(code) ?? 0,
            lastTimestamp: lastTimestampRef.current[stream].get(code) ?? null,
          });
          // 重置前的、retain 補送的舊快照、重送的同一則：不收，也不刷新有效時間
          if (!verdict.accept) return;
          receivedAtRef.current[stream].set(code, receivedAt);
          if (verdict.timestamp !== null) lastTimestampRef.current[stream].set(code, verdict.timestamp);
          // 收到就記：下面的去重會丟掉內容沒變的遙測（停站的車），但那仍然是「有收到」
          if (stream === 'telemetry') markVehicleSeen(code);
          pendingRef.current[stream].set(code, row);
          scheduleFlush();
        };
        socket.on(eventName, handler);
        handlers.push({ eventName, handler });
      }
    }

    return () => {
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      window.clearInterval(sweepTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('live-state/reset', onLiveStateReset);
      for (const { eventName, handler } of handlers) {
        socket.off(eventName, handler);
      }
      releaseSocket(ds.backendUrl);
    };
  }, [enabled]);

  return hub;
}
