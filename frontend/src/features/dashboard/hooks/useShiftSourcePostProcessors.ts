import { useMemo } from 'react';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import { mergeMainlineShiftRoster } from '../utils/mergeShiftRosterRows';

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
