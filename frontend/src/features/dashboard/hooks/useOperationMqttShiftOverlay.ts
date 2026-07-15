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
  const freshPayload =
    fleetPayload && mqttPayloadIsFresh(fleetPayload) ? fleetPayload : null;
  const simTick = useSimClockFrame(enabled && simPlaying && !!freshPayload);

  return useMemo(() => {
    const etaOverride = freshPayload
      ? extrapolateLegEtaSeconds(freshPayload, speedMultiplier, simPlaying)
      : undefined;
    return mergeOperationMqttShiftRow(sqlRow, freshPayload, etaOverride);
  }, [sqlRow, freshPayload, simPlaying, speedMultiplier, simTick]);
}
