import { useMemo } from 'react';
import { useMqttData } from '../elements/useMqttData';
import { mergeOperationMqttShiftRow } from '../utils/mergeOperationMqttShiftRow';

const DS_MQTT = 'default-mqtt';

/** 班次／整備卡：訂閱該車 operation/update，合併即時營運欄位 */
export function useOperationMqttShiftOverlay(
  vehicleCode: string | undefined,
  sqlRow: Record<string, unknown> | null,
  enabled: boolean,
): Record<string, unknown> {
  const topic = enabled && vehicleCode
    ? `v1/vtms/${vehicleCode}/operation/update`
    : undefined;

  const mqttState = useMqttData({
    mqttDataSourceId: topic ? DS_MQTT : undefined,
    mqttTopic: topic,
  });

  const mqttPayload =
    mqttState.data && typeof mqttState.data === 'object' && !('value' in mqttState.data)
      ? (mqttState.data as Record<string, unknown>)
      : null;

  return useMemo(
    () => mergeOperationMqttShiftRow(sqlRow, mqttPayload),
    [sqlRow, mqttPayload],
  );
}
