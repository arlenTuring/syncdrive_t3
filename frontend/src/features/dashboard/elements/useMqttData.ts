import { useEffect, useMemo, useState, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { acquireSocket, releaseSocket } from './socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { useVariables, interpolateVariables } from '../VariableContext';
import { useDemoSimulation } from '../context/DemoSimulationContext';

interface MqttState {
  data: Record<string, unknown> | null;
  connected: boolean;
  error: string | null;
}

/**
 * MQTT 即時資料訂閱 Hook
 * 透過 Socket.IO 連線到後端，並監聽轉發的 MQTT 訊息
 */
export function useMqttData(opts: {
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
}): MqttState {
  const { mqttDataSourceId, mqttTopic, mqttValuePath } = opts;
  const [state, setState] = useState<MqttState>({ data: null, connected: false, error: null });
  const socketRef = useRef<Socket | null>(null);
  const { paused } = useDemoSimulation();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const vars = useVariables();
  const varsKey = useMemo(() => {
    const keys = Object.keys(vars).sort();
    return keys.map(k => `${k}:${String(vars[k])}`).join('|');
  }, [vars]);

  useEffect(() => {
    if (!mqttDataSourceId || !mqttTopic) {
      setState({ data: null, connected: false, error: null });
      return;
    }

    const finalTopic = interpolateVariables(mqttTopic, vars);
    const ds = getDataSourceById(mqttDataSourceId);
    if (!ds || ds.type !== 'mqtt') {
      setState({ data: null, connected: false, error: '無效的 MQTT 資料來源' });
      return;
    }

    // 使用共用 Socket singleton，避免每個 Widget 建立獨立 WebSocket 連線
    const socket = acquireSocket(ds.backendUrl);
    socketRef.current = socket;

    // 具名 handler：清理時逐一移除，避免在共用 socket 上累積洩漏
    const onConnect = () => setState(s => ({ ...s, connected: true, error: null }));
    const onDisconnect = () => setState(s => ({ ...s, connected: false }));
    const onConnectError = (err: Error) =>
      setState(s => ({ ...s, connected: false, error: `連線失敗: ${err.message}` }));
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    if (socket.connected) setState(s => ({ ...s, connected: true, error: null }));

    // 監聽轉發的 MQTT 主題（後端 EventsGateway emit `mqtt/${topic}`）
    const eventName = `mqtt/${finalTopic}`;
    const onMessage = (payload: any) => {
      if (pausedRef.current) return;

      let extractedData = payload;

      // 安全取 JSON 路徑：缺欄位時為 undefined，絕不丟錯／洗版 console
      // （營運訊息在靠站/車庫時可能無 current_leg，屬正常情形）
      if (mqttValuePath && payload && typeof payload === 'object') {
        const parts = mqttValuePath.split('.');
        let temp: unknown = payload;
        for (const p of parts) {
          if (temp == null || typeof temp !== 'object') { temp = undefined; break; }
          temp = (temp as Record<string, unknown>)[p];
        }
        extractedData = { value: temp };
      }

      setState(s => ({ ...s, data: extractedData }));
    };
    socket.on(eventName, onMessage);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(eventName, onMessage);
      // 使用 releaseSocket 而非直接 disconnect，讓其他 Widget 可繼續複用連線
      releaseSocket(ds.backendUrl);
      socketRef.current = null;
    };
  }, [mqttDataSourceId, mqttTopic, mqttValuePath, varsKey]);

  return state;
}
