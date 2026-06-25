import type { MapAreaObject } from '../types/area';
import type { AreaVehicleLive } from './types';
import {
  buildTrackNetwork,
  resolveVehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement';

const DEMO_IDS = ['PMS-01', 'PMS-02', 'PMS-03', 'PMS-04'] as const;
const DEMO_HEALTH = ['OK', 'WARNING', 'ERROR', 'OFFLINE'] as const;
/** 示範作動代碼（不含號誌；號誌僅由 MQTT 停等紅綠燈時出現） */
const DEMO_ACTIONS = ['door_open', 'door_close', 'dispatch', 'alert'] as const;

function refFieldCenter(seg: {
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number };
}): { xM: number; yM: number } {
  const b = seg.bounds;
  return {
    xM: (b.xMinM + b.xMaxM) / 2,
    yM: (b.yMinM + b.yMaxM) / 2,
  };
}

/** 無 MQTT 時：在 refField 段中心放置示範車（不用 Area domain） */
export function buildDemoAreaVehicles(areas: MapAreaObject[]): AreaVehicleLive[] {
  const network = buildTrackNetwork(areas);
  if (network.segments.length === 0) return [];

  const segments = network.segments
    .slice()
    .sort((a, b) => (a.trackCode ?? a.trackId).localeCompare(b.trackCode ?? b.trackId));

  const out: AreaVehicleLive[] = [];
  DEMO_IDS.forEach((vehicleId, i) => {
    const seg = segments[i % segments.length];
    if (!seg) return;

    const { xM, yM } = refFieldCenter(seg);
    const placement = resolveVehiclePlacementAcrossAreas(areas, xM, yM, network);
    if (!placement) return;

    out.push({
      areaId: placement.area.id,
      vehicleId,
      xM,
      yM,
      payload: {
        vehicle_code: vehicleId,
        overall_health: DEMO_HEALTH[i],
        x: xM,
        y: yM,
        operation_action: DEMO_ACTIONS[i % DEMO_ACTIONS.length],
      },
      topic: '',
      updatedAt: 0,
      isDemo: true,
    });
  });

  return out;
}
