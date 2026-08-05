import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';
import {
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
} from './schedule-engine/physics';
import {
  resolveLeaveMarginSeconds,
  resolveRouteClearanceInsertGapSeconds,
} from './stationClearanceInsert';
import { resolveEffectiveRouteTravelSeconds } from './stationLegTravel';

export type StationBerthOccupancy = {
  stationId: string;
  stationName: string;
  timelineRow: number;
  blockId: string;
  routeCode: string | null;
  routeId: string | null;
  /** 到站（分鐘） */
  startMinute: number;
  /** 離站／可出發（分鐘）＝該站自然在站時間結束 */
  endMinute: number;
};

export type StationBerthCollision = {
  stationId: string;
  stationName: string;
  earlier: StationBerthOccupancy;
  later: StationBerthOccupancy;
  overlapSeconds: number;
  /** 後車進站與前車離站的間距（秒）；重疊時為負 */
  clearanceGapSeconds: number;
  requiredClearanceSeconds: number;
};

/**
 * 蒐集各停靠點跨車在站區間。
 *
 * 佔用＝該班在該站「到站～離站」的自然時間（還沒出發前本來就在這個空間），
 * **不是**正線結束後把充電／保養／行前／機動硬掛在末站上。
 */
export function collectStationBerthOccupancies(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
): StationBerthOccupancy[] {
  const out: StationBerthOccupancy[] = [];
  const minPresenceMin = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS / 60;

  for (const timeline of timelines) {
    const blocks = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );

    for (const block of blocks) {
      if (block.taskType !== 'passenger') continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      if (!route) continue;
      const stops = buildBlockStationDepartures(block, route);
      if (stops.length === 0) continue;

      for (let si = 0; si < stops.length; si += 1) {
        const stop = stops[si]!;
        const dwellMeta = route.stationDwells.find((d) => d.stationId === stop.stationId);
        const isPortal =
          looksLikeDefaultCrossoverPortalStationId(stop.stationId)
          || (dwellMeta != null && !isStationDwellRequired(dwellMeta));
        const isTerminal = si === stops.length - 1;
        const isOrigin = si === 0;

        let startMinute = stop.arrivalMinute;
        let endMinute = Math.max(stop.departureMinute, stop.arrivalMinute);

        // 途經／虛擬渡線且無實際停靠秒：不參與站位碰撞
        if (isPortal && !isOrigin && !isTerminal && stop.dwellSeconds <= 0) {
          continue;
        }

        // 有靠站秒數卻退化成點：補最小在站；純起終 0 秒也給一格，避免同秒進出漏判
        if (endMinute <= startMinute + 1e-12) {
          if (stop.dwellSeconds > 0 || isOrigin || isTerminal) {
            endMinute = startMinute + minPresenceMin;
          } else {
            continue;
          }
        }

        out.push({
          stationId: stop.stationId,
          stationName: stop.stationName,
          timelineRow: timeline.row,
          blockId: block.id,
          routeCode: block.routeCode ?? route.routeCode ?? null,
          routeId: block.routeId ?? route.routeId,
          startMinute,
          endMinute,
        });
      }
    }
  }

  return out;
}

function requiredClearanceSecondsForStation(
  stationId: string,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): number {
  for (const route of selectedRoutes) {
    const onRoute =
      route.stationIds?.includes(stationId)
      || route.stationDwells?.some((d) => d.stationId === stationId);
    if (!onRoute) continue;
    return resolveRouteClearanceInsertGapSeconds(
      route,
      resolveEffectiveRouteTravelSeconds(route),
      stationId,
    );
  }
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    resolveLeaveMarginSeconds({}),
  );
}

/**
 * 不同車在同一停靠點的「到站～離站」區間不得重疊。
 */
export function findStationBerthCollisions(
  occupancies: StationBerthOccupancy[],
  selectedRoutes: ShiftScheduleSelectedRoute[],
): StationBerthCollision[] {
  const byStation = new Map<string, StationBerthOccupancy[]>();
  for (const occ of occupancies) {
    const list = byStation.get(occ.stationId) ?? [];
    list.push(occ);
    byStation.set(occ.stationId, list);
  }

  const collisions: StationBerthCollision[] = [];
  for (const [, list] of byStation) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
    const required = requiredClearanceSecondsForStation(
      sorted[0]!.stationId,
      selectedRoutes,
    );
    const requiredMin = required / 60;

    for (let i = 0; i < sorted.length; i += 1) {
      const earlier = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const later = sorted[j]!;
        if (later.timelineRow === earlier.timelineRow) continue;
        if (later.startMinute >= earlier.endMinute + requiredMin - 1e-12) break;

        const overlapMin =
          Math.min(earlier.endMinute, later.endMinute)
          - Math.max(earlier.startMinute, later.startMinute);
        if (overlapMin <= 1e-9) {
          if (later.startMinute >= earlier.endMinute + requiredMin - 1e-12) break;
          continue;
        }

        collisions.push({
          stationId: earlier.stationId,
          stationName: earlier.stationName,
          earlier,
          later,
          overlapSeconds: minuteToSecond(overlapMin),
          clearanceGapSeconds: minuteToSecond(later.startMinute - earlier.endMinute),
          requiredClearanceSeconds: required,
        });
      }
    }
  }

  return collisions;
}
