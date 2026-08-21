import { useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../dashboard/elements/socketManager';
import { getDataSourceById } from '../dashboard/store/useDataSourceStore';
import type { PsdDoorMqttPayload, VehicleDoorMqttPayload } from './mapDoorMqtt';

const DS_MQTT = 'default-mqtt';

function asObject(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
}

/**
 * 訂閱車門／月台門 MQTT（Socket.IO `mqtt/{topic}`）。
 */
export function useDoorBodyMqtt(vehicleCodes: string[], psdIds: string[]) {
  const [byVehicle, setByVehicle] = useState<Map<string, VehicleDoorMqttPayload>>(() => new Map());
  const [byPsd, setByPsd] = useState<Map<string, PsdDoorMqttPayload>>(() => new Map());
  const byVehicleRef = useRef(byVehicle);
  const byPsdRef = useRef(byPsd);
  byVehicleRef.current = byVehicle;
  byPsdRef.current = byPsd;

  const vehicleKey = vehicleCodes.join('|');
  const psdKey = psdIds.join('|');

  useEffect(() => {
    const ds = getDataSourceById(DS_MQTT);
    if (!ds || ds.type !== 'mqtt') return;

    const socket = acquireSocket(ds.backendUrl);
    const handlers: Array<{ eventName: string; handler: (payload: unknown) => void }> = [];

    for (const code of vehicleCodes) {
      const topic = `v1/vtms/${code}/door/update`;
      const eventName = `mqtt/${topic}`;
      const handler = (payload: unknown) => {
        const row = asObject(payload);
        if (!row) return;
        const next = new Map(byVehicleRef.current);
        next.set(code, row as VehicleDoorMqttPayload);
        byVehicleRef.current = next;
        setByVehicle(next);
      };
      socket.on(eventName, handler);
      handlers.push({ eventName, handler });
    }

    for (const psdId of psdIds) {
      const topic = `v1/vtms/${psdId}/psd/update`;
      const eventName = `mqtt/${topic}`;
      const handler = (payload: unknown) => {
        const row = asObject(payload);
        if (!row) return;
        const next = new Map(byPsdRef.current);
        next.set(psdId, row as PsdDoorMqttPayload);
        byPsdRef.current = next;
        setByPsd(next);
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
  }, [vehicleKey, psdKey]);

  return { byVehicle, byPsd };
}
