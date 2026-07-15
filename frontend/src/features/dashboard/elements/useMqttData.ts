import { useEffect, useMemo, useState, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { acquireSocket, releaseSocket } from './socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { useVariables, interpolateVariables } from '../VariableContext';
import { useDemoSimulationPaused } from '../context/DemoSimulationPlaybackContext';
import { useVehicleFleetMqttHubContext } from '../context/VehicleFleetMqttContext';
import { parseVtmsVehicleTopic } from '../utils/vtmsTopic';

interface MqttState {
  data: Record<string, unknown> | null;
  connected: boolean;
  error: string | null;
}

function extractMqttValue(
  payload: Record<string, unknown>,
  mqttValuePath?: string,
): Record<string, unknown> {
  if (!mqttValuePath) return payload;
  const parts = mqttValuePath.split('.');
  let temp: unknown = payload;
  for (const p of parts) {
    if (temp == null || typeof temp !== 'object') {
      temp = undefined;
      break;
    }
    temp = (temp as Record<string, unknown>)[p];
  }
  return { value: temp };
}

/**
 * MQTT 即時資料訂閱 Hook
 * VTMS 車輛主題（telemetry / operation / health）改讀 VehicleFleetMqttHub，避免每 widget 重複訂閱。
 */
export function useMqttData(opts: {
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
}): MqttState {
  const { mqttDataSourceId, mqttTopic, mqttValuePath } = opts;
  const [state, setState] = useState<MqttState>({ data: null, connected: false, error: null });
  const socketRef = useRef<Socket | null>(null);
  const paused = useDemoSimulationPaused();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const fleetHub = useVehicleFleetMqttHubContext();
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
    && fleetParsed
    && fleetHub,
  );

  const fleetData = useMemo(() => {
    if (!useFleetHub || !fleetParsed || !fleetHub) return null;
    const raw = fleetHub[fleetParsed.stream].get(fleetParsed.vehicleCode);
    if (!raw) return null;
    return extractMqttValue(raw, mqttValuePath);
  }, [useFleetHub, fleetParsed, fleetHub, mqttValuePath, fleetHub?.tick]);

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

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(eventName, onMessage);
      releaseSocket(ds.backendUrl);
      socketRef.current = null;
    };
  }, [useFleetHub, mqttDataSourceId, mqttTopic, mqttValuePath, finalTopic]);

  if (useFleetHub && fleetHub) {
    return {
      data: fleetData,
      connected: fleetHub.connected,
      error: null,
    };
  }

  return state;
}
