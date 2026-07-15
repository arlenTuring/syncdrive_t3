import { useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../elements/socketManager';
import { getDataSourceById } from '../store/useDataSourceStore';
import { VTMS_VEHICLE_POOL } from '../constants/vtmsVehiclePool';
import { useDemoSimulationPaused } from '../context/DemoSimulationPlaybackContext';

const DS_MQTT = 'default-mqtt';

function operationRowKey(row: Record<string, unknown>): string {
  const leg =
    row.current_leg && typeof row.current_leg === 'object'
      ? (row.current_leg as Record<string, unknown>)
      : null;
  return [
    row.vehicle_code,
    row.order_id,
    row.trip_code,
    row.yard_slot_id,
    row.maint_type_label,
    row.vehicle_phase,
    row.operation_action,
    row.line_kind,
    leg?.target_station_id,
    leg?.eta_seconds,
    row.badge_label,
  ].join('|');
}

/**
 * @deprecated 已由 useVehicleFleetMqttHub 取代（VehicleFleetMqttProvider）。
 * 訂閱全車隊 operation/update（retain 亦會送達）。
 * 名冊槽位由 MQTT 即時增刪，不依 SQL 15s 輪詢。
 */
export function useShiftFleetOperationMqtt(enabled: boolean): Map<string, Record<string, unknown>> {
  const paused = useDemoSimulationPaused();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [byVehicle, setByVehicle] = useState<Map<string, Record<string, unknown>>>(() => new Map());
  const byVehicleRef = useRef(byVehicle);
  byVehicleRef.current = byVehicle;
  const pendingRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const rowKeyRef = useRef<Map<string, string>>(new Map());
  const flushRafRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = new Map();
      rowKeyRef.current = new Map();
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      setByVehicle(new Map());
      return;
    }

    const ds = getDataSourceById(DS_MQTT);
    if (!ds || ds.type !== 'mqtt') return;

    const socket = acquireSocket(ds.backendUrl);
    const handlers: Array<{ eventName: string; handler: (payload: unknown) => void }> = [];

    const scheduleFlush = () => {
      if (flushRafRef.current) return;
      flushRafRef.current = requestAnimationFrame(() => {
        flushRafRef.current = 0;
        let dirty = false;
        const next = new Map(byVehicleRef.current);
        for (const [code, row] of pendingRef.current) {
          const key = operationRowKey(row);
          if (rowKeyRef.current.get(code) === key) continue;
          rowKeyRef.current.set(code, key);
          next.set(code, row);
          dirty = true;
        }
        pendingRef.current = new Map();
        if (!dirty) return;
        byVehicleRef.current = next;
        setByVehicle(next);
      });
    };

    for (const vehicleCode of VTMS_VEHICLE_POOL) {
      const topic = `v1/vtms/${vehicleCode}/operation/update`;
      const eventName = `mqtt/${topic}`;
      const handler = (payload: unknown) => {
        if (pausedRef.current) return;
        if (!payload || typeof payload !== 'object') return;
        const row = payload as Record<string, unknown>;
        const code = String(row.vehicle_code ?? vehicleCode).toUpperCase();
        pendingRef.current.set(code, row);
        scheduleFlush();
      };
      socket.on(eventName, handler);
      handlers.push({ eventName, handler });
    }

    return () => {
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      for (const { eventName, handler } of handlers) {
        socket.off(eventName, handler);
      }
      releaseSocket(ds.backendUrl);
    };
  }, [enabled]);

  return byVehicle;
}
