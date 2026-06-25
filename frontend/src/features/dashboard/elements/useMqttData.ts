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

    socket.on('connect', () => {
      setState(s => ({ ...s, connected: true, error: null }));
    });

    socket.on('disconnect', () => {
      setState(s => ({ ...s, connected: false }));
    });

    socket.on('connect_error', (err) => {
      setState(s => ({ ...s, connected: false, error: `連線失敗: ${err.message}` }));
    });

    // 監聽轉發的 MQTT 主題
    // 後端 EventsGateway 會 emit `mqtt/${topic}`
    const eventName = `mqtt/${finalTopic}`;
    socket.on(eventName, (payload: any) => {
      if (pausedRef.current) return;

      let extractedData = payload;

      // 如果有指定 JSON 路徑，嘗試解析
      if (mqttValuePath && payload) {
        try {
          const parts = mqttValuePath.split('.');
          let temp = payload;
          for (const p of parts) {
            temp = temp[p];
          }
          extractedData = { value: temp }; // 包裝成物件以維持一致性
        } catch (e) {
          console.error(`[MQTT] Failed to extract path ${mqttValuePath}`, e);
        }
      }

      setState(s => ({ ...s, data: extractedData }));
    });

    return () => {
      socket.off(eventName);
      // 使用 releaseSocket 而非直接 disconnect，讓其他 Widget 可繼續複用連線
      releaseSocket(ds.backendUrl);
      socketRef.current = null;
    };
  }, [mqttDataSourceId, mqttTopic, mqttValuePath, varsKey]);

  return state;
}
