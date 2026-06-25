import { useEffect, useRef, useState } from 'react';
import type { MapAreaObject } from '../../map-editor/types/area';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import { getDataSourceById } from '../store/useDataSourceStore';
import { acquireSocket, releaseSocket } from './socketManager';
import { useDemoSimulation } from '../context/DemoSimulationContext';
import { createMapMqttIngestPipeline } from './mapMqttIngestPipeline';

export type MapMqttLiveState = {
  liveById: Record<string, MqttLiveEntry>;
  areaVehicles: AreaVehicleLive[];
};

/**
 * 圖台容器：訂閱 Area MQTT，更新設施 live 狀態與 Area 內車輛座標。
 *
 * 效能策略（不降低 MQTT / DB 頻率）：
 * - Socket 訊息 → ingest 緩衝（不觸發 React）
 * - requestAnimationFrame 每幀最多一次 setState
 * - 視覺狀態未變的載具重用物件參考，避免 11 台車重繪連鎖
 */
export function useMapMqttLive(areas: MapAreaObject[]): MapMqttLiveState {
  const [liveById, setLiveById] = useState<Record<string, MqttLiveEntry>>({});
  const [areaVehicles, setAreaVehicles] = useState<AreaVehicleLive[]>([]);
  const { liveClearEpoch } = useDemoSimulation();

  const pipelineRef = useRef<ReturnType<typeof createMapMqttIngestPipeline> | null>(null);

  useEffect(() => {
    const pipeline = createMapMqttIngestPipeline((snapshot) => {
      setLiveById(snapshot.liveById);
      setAreaVehicles(snapshot.areaVehicles);
    });
    pipelineRef.current = pipeline;
    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    pipelineRef.current?.reset();
    setLiveById({});
    setAreaVehicles([]);
  }, [liveClearEpoch]);

  useEffect(() => {
    pipelineRef.current?.setAreas(areas);
  }, [areas]);

  useEffect(() => {
    if (areas.length === 0) return undefined;

    const ds = getDataSourceById('default-mqtt');
    if (!ds || ds.type !== 'mqtt') return undefined;

    const socket = acquireSocket(ds.backendUrl);

    const onAnyMessage = (eventName: string, payload: unknown) => {
      if (!eventName.startsWith('mqtt/')) return;
      if (!payload || typeof payload !== 'object') return;

      const topic = eventName.slice('mqtt/'.length);
      const payloadObj = payload as Record<string, unknown>;

      pipelineRef.current?.ingest(topic, payloadObj);
    };

    socket.onAny(onAnyMessage);

    return () => {
      socket.offAny(onAnyMessage);
      releaseSocket(ds.backendUrl);
    };
  }, [areas]);

  return { liveById, areaVehicles };
}
