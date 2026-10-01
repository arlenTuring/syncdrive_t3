import { useMemo } from 'react';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import { mergeMainlineShiftRoster } from '../utils/mergeShiftRosterRows';

export const POST_PROCESSOR_DEFINITIONS = [
  {
    id: 'mainline-mqtt-merge',
    label: '正線即時車況合併',
    description: '依車號以 MQTT operation/update 覆寫下一站、剩餘時間與行程進度。',
    mqtt: {
      // 與 useVehicleFleetMqttHub 的實際訂閱一致；這是後處理輸入，不會複製到子元件。
      dataSourceId: 'default-mqtt',
      topic: 'v1/vtms/${vehicle_code}/operation/update',
      inputsByOutput: {
        order_status: ['order_status', 'vehicle_phase'],
        status_label: ['order_status', 'vehicle_phase', 'delay_minutes (SQL)'],
        next_station: ['current_leg.target_station_id', 'route_stations (SQL)'],
        eta_remain: ['current_leg.eta_seconds', 'trip_start_minutes (SQL fallback)'],
        trip_code: ['trip_code'],
        vehicle_code: ['vehicle_code'],
        route_progress: ['current_leg.target_station_id', 'current_leg.eta_seconds'],
        segment_index: ['current_leg.target_station_id'],
        segment_remain_pct: ['current_leg.eta_seconds'],
      } as Record<string, string[]>,
    },
  },
] as const;

export function getPostProcessorDefinition(id: string | undefined) {
  return POST_PROCESSOR_DEFINITIONS.find((item) => item.id === id);
}

/**
 * 泛用群組來源的後處理表（依來源設定的 postProcessId 查表）。執行畫面與編輯預覽共用這一份，
 * 編輯時看到的列才會跟執行時一樣。
 */
export function useShiftSourcePostProcessors() {
  const fleetMqtt = useShiftFleetMqttMap();
  return useMemo(
    () => ({
      'mainline-mqtt-merge': (rows: Record<string, unknown>[]) => mergeMainlineShiftRoster(rows, fleetMqtt),
    }),
    [fleetMqtt],
  );
}
