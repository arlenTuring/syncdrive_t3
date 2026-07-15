import { createContext, useContext, type ReactNode } from 'react';
import {
  useVehicleFleetMqttHub,
  type VehicleFleetMqttHub,
} from '../hooks/useVehicleFleetMqttHub';
import type { VtmsStreamKind } from '../utils/vtmsTopic';

const VehicleFleetMqttContext = createContext<VehicleFleetMqttHub | null>(null);

/** 全儀表板共用 VTMS 車隊 MQTT（telemetry / operation / health） */
export function VehicleFleetMqttProvider({ children }: { children: ReactNode }) {
  const hub = useVehicleFleetMqttHub(true);
  return (
    <VehicleFleetMqttContext.Provider value={hub}>
      {children}
    </VehicleFleetMqttContext.Provider>
  );
}

export function useVehicleFleetMqttHubContext(): VehicleFleetMqttHub | null {
  return useContext(VehicleFleetMqttContext);
}

export function useVehicleFleetStreamPayload(
  vehicleCode: string | undefined,
  stream: VtmsStreamKind,
): Record<string, unknown> | null {
  const hub = useVehicleFleetMqttHubContext();
  void hub?.tick;
  if (!hub || !vehicleCode) return null;
  return hub[stream].get(vehicleCode.trim().toUpperCase()) ?? null;
}

/** @deprecated 改用 useVehicleFleetStreamPayload(code, 'operation') */
const EMPTY_OPERATION = new Map<string, Record<string, unknown>>();

export function useShiftFleetMqttMap(): Map<string, Record<string, unknown>> {
  const hub = useVehicleFleetMqttHubContext();
  // tick 變更代表 Map 內容已更新（Map 為 in-place mutate）
  void hub?.tick;
  return hub?.operation ?? EMPTY_OPERATION;
}

export function useShiftVehicleOperationMqtt(
  vehicleCode: string | undefined,
): Record<string, unknown> | null {
  return useVehicleFleetStreamPayload(vehicleCode, 'operation');
}
