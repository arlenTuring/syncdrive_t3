import { useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../elements/socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { VTMS_VEHICLE_POOL } from '../constants/vtmsVehiclePool';
import { useDemoSimulation } from '../context/DemoSimulationContext';

const DS_MQTT = 'default-mqtt';

/**
 * 訂閱全車隊 operation/update（retain 亦會送達）。
 * 名冊槽位由 MQTT 即時增刪，不依 SQL 15s 輪詢。
 */
export function useShiftFleetOperationMqtt(enabled: boolean): Map<string, Record<string, unknown>> {
  const { paused } = useDemoSimulation();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [byVehicle, setByVehicle] = useState<Map<string, Record<string, unknown>>>(() => new Map());
  const byVehicleRef = useRef(byVehicle);
  byVehicleRef.current = byVehicle;

  useEffect(() => {
    if (!enabled) {
      setByVehicle(new Map());
      return;
    }

    const ds = getDataSourceById(DS_MQTT);
    if (!ds || ds.type !== 'mqtt') return;

    const socket = acquireSocket(ds.backendUrl);
    const handlers: Array<{ eventName: string; handler: (payload: unknown) => void }> = [];

    for (const vehicleCode of VTMS_VEHICLE_POOL) {
      const topic = `v1/vtms/${vehicleCode}/operation/update`;
      const eventName = `mqtt/${topic}`;
      const handler = (payload: unknown) => {
        if (pausedRef.current) return;
        if (!payload || typeof payload !== 'object') return;
        const row = payload as Record<string, unknown>;
        const code = String(row.vehicle_code ?? vehicleCode).toUpperCase();
        const next = new Map(byVehicleRef.current);
        next.set(code, row);
        byVehicleRef.current = next;
        setByVehicle(next);
      };
      socket.on(eventName, handler);
      handlers.push({ eventName, handler });
    }

    return () => {
      for (const { eventName, handler } of handlers) {
        socket.off(eventName, handler);
      }
      releaseSocket(ds.backendUrl);
    };
  }, [enabled]);

  return byVehicle;
}
