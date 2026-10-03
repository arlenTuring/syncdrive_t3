import { useMemo } from 'react';
import { mergeOperationMqttShiftRow } from '../utils/mergeOperationMqttShiftRow';
import { mqttPayloadIsFresh } from '../route-progress/useAnimatedTrackPercent';
import { useDemoSimulationPlayback } from '../context/DemoSimulationPlaybackContext';
import { useShiftVehicleOperationMqtt } from '../context/ShiftFleetMqttContext';
import { extrapolateLegEtaSeconds } from '../utils/simClock';
import { useSimClockFrame } from '../utils/simClockFrame';

/** 班次／整備卡：合併全車隊 MQTT operation/update，合併即時營運欄位 */
export function useOperationMqttShiftOverlay(
  vehicleCode: string | undefined,
  sqlRow: Record<string, unknown> | null,
  enabled: boolean,
): Record<string, unknown> {
  const { running, paused, transportPaused, speedMultiplier } = useDemoSimulationPlayback();
  const simPlaying = running && !paused && !transportPaused;
  const fleetPayload = useShiftVehicleOperationMqtt(enabled ? vehicleCode : undefined);
  const rowOrderId = String(sqlRow?.shift_key ?? sqlRow?.order_id ?? '').trim();
  const mqttOrderId = String(fleetPayload?.order_id ?? '').trim();
  // 只套用「同一張單」的回報：任一邊沒有單號就不套，不能因為車號相同就把上一班的回報
  // 掛到這張卡上
  const freshPayload =
    fleetPayload
    && mqttPayloadIsFresh(fleetPayload)
    && rowOrderId !== ''
    && rowOrderId === mqttOrderId
      ? fleetPayload
      : null;
  const simTick = useSimClockFrame(enabled && simPlaying && !!freshPayload);

  return useMemo(() => {
    const etaOverride = freshPayload
      ? extrapolateLegEtaSeconds(freshPayload, speedMultiplier, simPlaying)
      : undefined;
    return mergeOperationMqttShiftRow(sqlRow, freshPayload, etaOverride);
  }, [sqlRow, freshPayload, simPlaying, speedMultiplier, simTick]);
}
