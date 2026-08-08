import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { findTopologyPath } from './findTopologyPath';
import {
  extractFacilityMapCodes,
  type MaintenanceBodySectionKey,
} from './maintenanceFirstTripOrigins';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 整備入廠卡（MI · Maintenance In）
 * =================================
 *
 * 車輛<strong>確定不能再跑正線</strong>之後，提前開進接下來預計進入的整備區。
 *
 * 關鍵規則——<strong>整備開始時刻跟著提前，結束時刻不動</strong>：
 * <pre>
 * 原本      整備 01:00 ──────────── 02:00
 * MI 00:50 抵達
 * 變成  MI卡 ┤00:50 ──────────────── 02:00   （時長變長，不是整段前移）
 * </pre>
 *
 * 與整備出廠卡（MO）剛好對稱：MO 吃整備的尾巴，MI 長整備的頭。
 *
 * 路徑不由使用者指定，走 {@link findTopologyPath} 從「車現在所在的站」
 * 找到「要進的設施」——設施之間的移動有 N×M 種組合，不可能要人一條條畫。
 * 方向嚴格遵守拓樸（例如 M 系設施入廠要走 T3下行，走 T3上行就是逆行）。
 */

/** 整備任務類型 → 整備中心設施區段鍵 */
const FACILITY_SECTION_BY_TASK_TYPE: Partial<
  Record<TaskTypeKey, MaintenanceBodySectionKey>
> = {
  charging: 'charging',
  inspection: 'preTrip',
  standby: 'mobile',
  servicing: 'maintenance',
  washing: 'carWash',
};

const YARD_TASK_TYPES = new Set<string>([
  'charging',
  'inspection',
  'standby',
  'servicing',
  'washing',
]);

export type YardEntryMoveCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  inserted: number;
  /** 因為整備開始提前而變長的整備段數 */
  yardHeadExtended: number;
  skipped: Array<{ timelineRow: number; taskType: string; reason: string }>;
};

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** 拓樸節點是否命中整備任務設定的設施 mapCode */
function nodeMatchesCodes(
  node: { id: string; label?: string },
  codes: string[],
): boolean {
  if (codes.length === 0) return false;
  const id = normalizeCode(node.id);
  const label = normalizeCode(node.label ?? '');
  return codes.some((raw) => {
    const code = normalizeCode(raw);
    if (!code || code === 'UNSPECIFIED') return false;
    return code === id || code === label || label.startsWith(code) || id.endsWith(code);
  });
}

type FacilityBooking = {
  facilityNodeId: string;
  startSecond: number;
  endSecond: number;
  timelineRow: number;
};

function facilityIsFree(
  bookings: FacilityBooking[],
  facilityNodeId: string,
  startSecond: number,
  endSecond: number,
  timelineRow: number,
): boolean {
  return !bookings.some(
    (b) =>
      b.facilityNodeId === facilityNodeId
      && b.timelineRow !== timelineRow
      && b.startSecond < endSecond - 1e-9
      && startSecond < b.endSecond - 1e-9,
  );
}

export function insertYardEntryMoveCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  maintenanceBody: Record<string, unknown> | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
}): YardEntryMoveCardsResult {
  const {
    timelines,
    topology,
    maintenanceBody,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
  } = args;
  const skipped: YardEntryMoveCardsResult['skipped'] = [];
  let inserted = 0;
  let yardHeadExtended = 0;

  if (!topology || topology.nodes.length === 0) {
    return { timelines, inserted, yardHeadExtended, skipped };
  }

  const routeEndStation = new Map<string, string>();
  for (const route of selectedRoutes) {
    const end = route.stationIds?.[route.stationIds.length - 1]?.trim();
    if (route.routeId && end) routeEndStation.set(route.routeId, end);
  }

  /** stationId → 拓樸節點 id（停靠節點的 stationId 才是路線用的站碼） */
  const nodeIdByStationId = new Map<string, string>();
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (stationId) nodeIdByStationId.set(stationId, node.id);
  }

  const codesBySection = new Map<MaintenanceBodySectionKey, string[]>();
  const facilityNodesFor = (taskType: string) => {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as TaskTypeKey];
    if (!section) return [];
    let codes = codesBySection.get(section);
    if (!codes) {
      codes = extractFacilityMapCodes(maintenanceBody, section);
      codesBySection.set(section, codes);
    }
    return topology.nodes.filter(
      (node) => node.kind === 'facility' && nodeMatchesCodes(node, codes!),
    );
  };

  const bookings: FacilityBooking[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;
      // 連續整備串只在串首入廠：車是開進串首那一段的設施
      const prevYard = sorted[i - 1];
      if (prevYard && YARD_TASK_TYPES.has(prevYard.taskType)) continue;

      // 車現在在哪：往回找最後一段載客，取它的終點站
      const previousPassenger = [...sorted.slice(0, i)]
        .reverse()
        .find((block) => block.taskType === 'passenger');
      if (!previousPassenger?.routeId) continue;
      const stationId = routeEndStation.get(previousPassenger.routeId);
      const fromNodeId = stationId ? nodeIdByStationId.get(stationId) : undefined;
      if (!fromNodeId) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: `前一段載客的終點站在拓樸上找不到對應節點（${stationId ?? '未知'}）`,
        });
        continue;
      }

      const facilities = facilityNodesFor(yard.taskType);
      if (facilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
        });
        continue;
      }

      // 車一跑完就能走；到得越早整備就從越早開始
      const freeSecond = minuteToSecond(previousPassenger.plannedEndMinute)
        + Math.max(0, minimumRecoveryTimeSeconds);
      const yardStartSecond = minuteToSecond(yard.plannedStartMinute);
      if (freeSecond >= yardStartSecond - 1e-9) {
        // 沒有提前的空間——車跑到整備開始才空出來，維持原樣
        continue;
      }

      let chosen: { nodeId: string; label: string; seconds: number } | null = null;
      for (const facility of facilities) {
        const path = findTopologyPath(topology, fromNodeId, facility.id);
        if (!path) continue;
        const arriveSecond = freeSecond + path.avgSeconds;
        // 到得比原訂整備開始還晚就沒有「提前」可言，不插
        if (arriveSecond >= yardStartSecond - 1e-9) continue;
        if (
          !facilityIsFree(bookings, facility.id, arriveSecond, yardStartSecond, timeline.row)
        ) {
          continue;
        }
        if (!chosen || path.avgSeconds < chosen.seconds) {
          chosen = {
            nodeId: facility.id,
            label: facility.label || facility.id,
            seconds: path.avgSeconds,
          };
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          taskType: yard.taskType,
          reason: '拓樸上到不了任何一座該類設施，或設施都被別列車佔著',
        });
        continue;
      }

      const arriveSecond = freeSecond + chosen.seconds;
      const card: GeneratedScheduleBlock = {
        id: `yardentry-${yard.id}-${Math.round(freeSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · → ${chosen.label}`,
        anchorStartMinute: secondToMinute(freeSecond),
        plannedStartMinute: secondToMinute(freeSecond),
        plannedEndMinute: secondToMinute(arriveSecond),
        travelSeconds: chosen.seconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        moveCardTag: 'MI',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: stationId,
      };
      timeline.blocks.push(card);

      // 整備開始跟著提前、結束不動 → 時長變長
      yard.plannedStartMinute = secondToMinute(arriveSecond);
      yardHeadExtended += 1;
      bookings.push({
        facilityNodeId: chosen.nodeId,
        startSecond: arriveSecond,
        endSecond: minuteToSecond(yard.plannedEndMinute),
        timelineRow: timeline.row,
      });
      inserted += 1;
    }
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return { timelines, inserted, yardHeadExtended, skipped };
}
