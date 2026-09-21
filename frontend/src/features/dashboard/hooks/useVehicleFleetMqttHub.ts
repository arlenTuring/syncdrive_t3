import { useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../elements/socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { VTMS_DEBUG_VEHICLES, VTMS_VEHICLE_POOL } from '../constants/vtmsVehiclePool';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import type { VtmsStreamKind } from '../utils/vtmsTopic';
import { vtmsRowKeyForStream } from '../utils/vtmsMqttRowKey';

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
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
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
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const { eventName, handler } of handlers) {
        socket.off(eventName, handler);
      }
      releaseSocket(ds.backendUrl);
    };
  }, [enabled]);

  return hub;
}
