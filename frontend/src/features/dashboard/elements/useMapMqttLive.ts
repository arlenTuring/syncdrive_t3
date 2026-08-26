import { useEffect, useRef, useState } from 'react';
import type { MapAreaObject } from '../../map-editor/types/area';
import type { MqttLiveEntry } from '../../map-editor/live/mqttLiveTypes';
import type { AreaVehicleLive } from '../../map-editor/vehicles/types';
import { getDataSourceById } from '../store/useDataSourceStore';
import { acquireSocket, releaseSocket } from './socketManager';
import { useDemoSimulationLiveClearEpoch, useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import { useVehicleFleetMqttHubContext } from '../context/VehicleFleetMqttContext';
import { isVtmsVehicleStreamTopic } from '../utils/vtmsTopic';
import { createMapMqttIngestPipeline } from './mapMqttIngestPipeline';

export type MapMqttLiveState = {
  liveById: Record<string, MqttLiveEntry>;
  areaVehicles: AreaVehicleLive[];
};

/**
 * 圖台容器：訂閱 Area MQTT，更新設施 live 狀態與 Area 內車輛座標。
 *
 * 效能策略：
 * - VTMS 車輛：VehicleFleetMqttHub 單點訂閱 → hub.tick 驅動 ingest（不再 socket.onAny 重複消化）
 * - 設施 / syncdrive：socket.onAny 僅處理非 VTMS topic
 * - requestAnimationFrame 每幀最多一次 flush
 * - live / vehicles 分開 setState，避免不必要的整棵樹重繪
 * - pause / liveClearEpoch：reset pipeline 並清空 React 快照
 */
export function useMapMqttLive(areas: MapAreaObject[]): MapMqttLiveState {
  const [liveById, setLiveById] = useState<Record<string, MqttLiveEntry>>({});
  const [areaVehicles, setAreaVehicles] = useState<AreaVehicleLive[]>([]);
  const liveClearEpoch = useDemoSimulationLiveClearEpoch();
  /**
   * 何時該停止吃 MQTT。
   *
   * <strong>不能用 paused。</strong>那個旗標是 <code>!status.running</code>——
   * 「示範模擬器沒在跑」。真實車隊從外面推 MQTT 進來時示範模擬器本來就不會跑，
   * 於是所有即時車輛被當成暫停整批丟掉，畫面上只剩靜態示範車（2026-08-26 實測：
   * 本機模擬器 11 台全部在線、遙測也確實送達瀏覽器，地圖上卻一台都沒有）。
   *
   * 真正該停的只有一種情況：<strong>示範回放正在跑而且被使用者按了暫停</strong>。
   * 那時畫面要凍住當下那一幀，不該繼續前進。
   */
  const { running, transportPaused } = useDemoSimulationPlayback();
  const paused = running && transportPaused;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const fleetHub = useVehicleFleetMqttHubContext();
  const ingestCountRef = useRef(0);

  const pipelineRef = useRef<ReturnType<typeof createMapMqttIngestPipeline> | null>(null);

  useEffect(() => {
    const pipeline = createMapMqttIngestPipeline((snapshot) => {
      if (snapshot.liveChanged) setLiveById(snapshot.liveById);
      if (snapshot.vehiclesChanged) setAreaVehicles(snapshot.areaVehicles);
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
    if (!paused) return;
    pipelineRef.current?.reset();
    setLiveById({});
    setAreaVehicles([]);
  }, [paused]);

  useEffect(() => {
    pipelineRef.current?.setAreas(areas);
  }, [areas]);

  useEffect(() => {
    if (paused || areas.length === 0 || !fleetHub) return;
    pipelineRef.current?.ingestVtmsFromFleetHub(fleetHub.telemetry, fleetHub.operation);
  }, [fleetHub?.tick, paused, areas]);

  useEffect(() => {
    if (areas.length === 0) return undefined;

    const ds = getDataSourceById('default-mqtt');
    if (!ds || ds.type !== 'mqtt') return undefined;

    const socket = acquireSocket(ds.backendUrl);

    const onAnyMessage = (eventName: string, payload: unknown) => {
      if (pausedRef.current) return;
      if (!eventName.startsWith('mqtt/')) return;
      if (!payload || typeof payload !== 'object') return;

      const topic = eventName.slice('mqtt/'.length);
      if (topic.includes('/health/')) return;
      if (isVtmsVehicleStreamTopic(topic)) return;

      const payloadObj = payload as Record<string, unknown>;

      if (import.meta.env.DEV) ingestCountRef.current += 1;
      pipelineRef.current?.ingest(topic, payloadObj);
    };

    socket.onAny(onAnyMessage);

    let statsTimer: ReturnType<typeof setInterval> | undefined;
    if (import.meta.env.DEV) {
      statsTimer = setInterval(() => {
        const n = ingestCountRef.current;
        ingestCountRef.current = 0;
        if (n > 0) {
          console.info(`[MapMqttLive] ~${Math.round(n / 10)} facility msg/s (10s window)`);
        }
      }, 10_000);
    }

    return () => {
      socket.offAny(onAnyMessage);
      releaseSocket(ds.backendUrl);
      if (statsTimer) clearInterval(statsTimer);
    };
  }, [areas]);

  return { liveById, areaVehicles };
}
