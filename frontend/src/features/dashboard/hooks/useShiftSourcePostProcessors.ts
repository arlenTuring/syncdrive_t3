import { useMemo } from 'react';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import { mergeMainlineShiftRoster } from '../utils/mergeShiftRosterRows';

export const POST_PROCESSOR_DEFINITIONS = [
  {
    id: 'mainline-mqtt-merge',
    label: '正線即時車況合併',
    description: '依車號以 MQTT operation/update 覆寫下一站、剩餘時間與行程進度。',
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
