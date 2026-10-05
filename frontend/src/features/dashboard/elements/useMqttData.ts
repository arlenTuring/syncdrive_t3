import { useEffect, useMemo, useState, useRef } from 'react';
import { usePlaneSourceId } from '../context/PlaneDataSourceContext';
import { VTMS_FLEET_HUB_SOURCE_ID } from '../hooks/useVehicleFleetMqttHub';
import type { Socket } from 'socket.io-client';
import { acquireSocket, releaseSocket } from './socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { useVariables, interpolateVariables } from '../VariableContext';
import { useDemoSimulationPaused } from '../context/DemoSimulationPlaybackContext';
import { useHasVehicleFleetHub, useVehicleFleetSelector } from '../context/VehicleFleetMqttContext';
import { parseVtmsVehicleTopic } from '../utils/vtmsTopic';

interface MqttState {
  data: Record<string, unknown> | null;
  connected: boolean;
  error: string | null;
}

function readMqttPath(payload: Record<string, unknown>, mqttValuePath: string): unknown {
  let temp: unknown = payload;
  for (const p of mqttValuePath.split('.')) {
    if (temp == null || typeof temp !== 'object') return undefined;
    temp = (temp as Record<string, unknown>)[p];
  }
  return temp;
}

function extractMqttValue(
  payload: Record<string, unknown>,
  mqttValuePath?: string,
): Record<string, unknown> {
  if (!mqttValuePath) return payload;
  return { value: readMqttPath(payload, mqttValuePath) };
}

/** 車隊 hub 裡還沒有這台車的這個串流 */
const NO_FLEET_ROW = Symbol('no-fleet-row');

/**
 * MQTT 即時資料訂閱 Hook
 * VTMS 車輛主題（telemetry / operation / health）改讀 VehicleFleetMqttHub，避免每 widget 重複訂閱。
 */
export function useMqttData(opts: {
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
}): MqttState {
  const { mqttTopic, mqttValuePath } = opts;
  // 這張儀表板「資料設定」選的 MQTT 連線；車隊 hub 用的是同一個解析結果（default-mqtt 的對應）
  const mqttDataSourceId = usePlaneSourceId(opts.mqttDataSourceId);
  const fleetHubSourceId = usePlaneSourceId(VTMS_FLEET_HUB_SOURCE_ID);
  const [state, setState] = useState<MqttState>({ data: null, connected: false, error: null });
  const socketRef = useRef<Socket | null>(null);
  const paused = useDemoSimulationPaused();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const hasFleetHub = useHasVehicleFleetHub();
  const vars = useVariables();
  const varsKey = useMemo(() => {
    const keys = Object.keys(vars).sort();
    return keys.map(k => `${k}:${String(vars[k])}`).join('|');
  }, [vars]);

  const finalTopic = useMemo(() => {
    if (!mqttTopic) return '';
    return interpolateVariables(mqttTopic, vars);
  }, [mqttTopic, varsKey]);

  const fleetParsed = useMemo(
    () => (finalTopic ? parseVtmsVehicleTopic(finalTopic) : null),
    [finalTopic],
  );

  const useFleetHub = Boolean(
    mqttDataSourceId
    && mqttDataSourceId === fleetHubSourceId
    && fleetParsed
    && hasFleetHub,
  );

  // 只挑自己那一個值：值沒變就不重畫（整張儀表板不再跟著每一波遙測重畫）。
  // 有路徑時挑原始子值，不能在 selector 裡包 { value }——每次都是新物件，等於每波都重畫。
  const fleetSelected = useVehicleFleetSelector<unknown>((hub) => {
    if (!useFleetHub || !fleetParsed) return NO_FLEET_ROW;
    const raw = hub[fleetParsed.stream].get(fleetParsed.vehicleCode);
    if (!raw) return NO_FLEET_ROW;
    return mqttValuePath ? readMqttPath(raw, mqttValuePath) : raw;
  }, NO_FLEET_ROW);
  const fleetConnected = useVehicleFleetSelector((hub) => hub.connected, false);

  const fleetData = useMemo((): Record<string, unknown> | null => {
    if (fleetSelected === NO_FLEET_ROW) return null;
    if (mqttValuePath) return { value: fleetSelected };
    return fleetSelected as Record<string, unknown>;
  }, [fleetSelected, mqttValuePath]);

  useEffect(() => {
    if (useFleetHub) {
      setState({ data: null, connected: false, error: null });
      return;
    }

    if (!mqttDataSourceId || !mqttTopic) {
      setState({ data: null, connected: false, error: null });
      return;
    }

    const ds = getDataSourceById(mqttDataSourceId);
    if (!ds || ds.type !== 'mqtt') {
      setState({ data: null, connected: false, error: '無效的 MQTT 資料來源' });
      return;
    }

    const socket = acquireSocket(ds.backendUrl);
    socketRef.current = socket;

    const onConnect = () => setState(s => ({ ...s, connected: true, error: null }));
    const onDisconnect = () => setState(s => ({ ...s, connected: false }));
    const onConnectError = (err: Error) =>
      setState(s => ({ ...s, connected: false, error: `連線失敗: ${err.message}` }));
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    if (socket.connected) setState(s => ({ ...s, connected: true, error: null }));

    const eventName = `mqtt/${finalTopic}`;
    const onMessage = (payload: unknown) => {
      if (pausedRef.current) return;
      if (!payload || typeof payload !== 'object') return;
      setState(s => ({
        ...s,
        data: extractMqttValue(payload as Record<string, unknown>, mqttValuePath),
      }));
    };
    socket.on(eventName, onMessage);
    // 後端重置測試資料：主題裡帶到被重置的車號，就把手上的舊訊息丟掉（不留到下一則來）
    const onLiveStateReset = (payload: { vehicleCodes?: string[] }) => {
      const codes = (payload?.vehicleCodes ?? []).map((code) => String(code).toUpperCase());
      const topicUpper = finalTopic.toUpperCase();
      if (codes.some((code) => topicUpper.split('/').includes(code))) {
        setState(s => ({ ...s, data: null }));
      }
    };
    socket.on('live-state/reset', onLiveStateReset);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(eventName, onMessage);
      socket.off('live-state/reset', onLiveStateReset);
      releaseSocket(ds.backendUrl);
      socketRef.current = null;
    };
  }, [useFleetHub, mqttDataSourceId, mqttTopic, mqttValuePath, finalTopic]);

  if (useFleetHub) {
    return {
      data: fleetData,
      connected: fleetConnected,
      error: null,
    };
  }

  return state;
}
