import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { findTopologyPath } from './findTopologyPath';
import { extractFacilityMapCodes } from './maintenanceFirstTripOrigins';
import type { MaintenanceSectionCodeBySection } from './maintenanceSectionCode';
import {
  nodeMatchesMoveCardCodes,
  moveCardFacilityIsFree,
  type MoveCardFacilityBooking,
} from './moveCardShared';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 調度入廠卡（PI · Park In）／調度出廠卡（PO · Park Out）
 * ======================================================
 *
 * 觸發條件：車輛<strong>接下來沒有任何班次可接</strong>，而且那段空檔長到
 * 會把終點站的停靠點佔死。一個停靠點只能停一台車，車在那裡乾等就等於
 * 讓別台車進不來——與其佔著正線站位，不如開進調度設施停放。
 *
 * <pre>
 * 正線…到站 ─┤PI├─ 停在調度設施 ─┤PO├─ 首站發車 …正線
 * </pre>
 *
 * 兩條規則來自使用者：
 * <ol>
 *   <li><strong>必須先跑完停靠站把客人放下</strong>才能進廠——它只是暫停，
 *   不是收班，所以 PI 一定接在完整的載客段之後，不會把班次砍短。</li>
 *   <li>暫停結束用 PO 開回正線，回到<strong>下一段班次的起點站</strong>。
 *   不繞複雜路徑：進得去、出得來、接得上，就這樣。</li>
 * </ol>
 *
 * 與整備入廠卡（MI）的分工：中間<strong>有</strong>整備任務的歸 MI
 * （那是預定要進廠做事）；中間<strong>沒有</strong>整備、純粹是沒班次可跑的
 * 才歸 PI／PO。
 */

/**
 * 空檔多長才值得進廠暫停（秒）。
 *
 * 太短就進廠划不來——來回移動本身要時間，而且設施也是有限資源；
 * 太長才動又會讓車在正線站位上乾等，把別台車擋在外面。
 * 15 分鐘是個保守起點：它明顯大於一般班距，代表「這段時間真的沒班可接」。
 */
export const PARK_IDLE_THRESHOLD_SECONDS = 900;

export type ParkMoveCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 插入的 PI／PO 成對數 */
  inserted: number;
  skipped: Array<{ timelineRow: number; reason: string }>;
};

export function insertParkMoveCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  maintenanceBody: Record<string, unknown> | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** 空檔門檻（秒）；不給用 PARK_IDLE_THRESHOLD_SECONDS */
  idleThresholdSeconds?: number;
  /** 整備區塊代號；調度的代號（parking）用來把 PI／PO 卡面／班次代號算好寫進卡片 */
  sectionCodes?: MaintenanceSectionCodeBySection | null;
}): ParkMoveCardsResult {
  const {
    timelines,
    topology,
    maintenanceBody,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
    sectionCodes,
  } = args;
  const threshold = args.idleThresholdSeconds ?? PARK_IDLE_THRESHOLD_SECONDS;
  const skipped: ParkMoveCardsResult['skipped'] = [];
  let inserted = 0;

  if (!topology || topology.nodes.length === 0) {
    return { timelines, inserted, skipped };
  }

  const parkingCodes = extractFacilityMapCodes(maintenanceBody, 'parking');
  const parkingNodes = topology.nodes.filter(
    (node) => node.kind === 'facility' && nodeMatchesMoveCardCodes(node, parkingCodes),
  );
  if (parkingNodes.length === 0) {
    return { timelines, inserted, skipped };
  }

  const routeEndStation = new Map<string, string>();
  const routeStartStation = new Map<string, string>();
  for (const route of selectedRoutes) {
    const ids = route.stationIds ?? [];
    const start = ids[0]?.trim();
    const end = ids[ids.length - 1]?.trim();
    if (!route.routeId) continue;
    if (start) routeStartStation.set(route.routeId, start);
    if (end) routeEndStation.set(route.routeId, end);
  }

  const nodeIdByStationId = new Map<string, string>();
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (stationId) nodeIdByStationId.set(stationId, node.id);
  }

  const bookings: MoveCardFacilityBooking[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const before = sorted[i]!;
      const after = sorted[i + 1]!;
      // 兩段都是載客、而且在排序後相鄰＝中間沒有整備任務。
      // 中間有整備的空檔歸整備入廠卡（MI）管，這裡不碰。
      if (before.taskType !== 'passenger' || after.taskType !== 'passenger') continue;
      if (!before.routeId || !after.routeId) continue;

      // 車必須先跑完停靠站把客人放下——PI 一定接在完整的載客段之後
      const freeSecond = minuteToSecond(before.plannedEndMinute)
        + Math.max(0, minimumRecoveryTimeSeconds);
      const nextStartSecond = minuteToSecond(after.plannedStartMinute);
      const idleSeconds = nextStartSecond - freeSecond;
      if (idleSeconds < threshold) continue;

      const parkedStationId = routeEndStation.get(before.routeId);
      const resumeStationId = routeStartStation.get(after.routeId);
      const fromNodeId = parkedStationId
        ? nodeIdByStationId.get(parkedStationId)
        : undefined;
      const backNodeId = resumeStationId
        ? nodeIdByStationId.get(resumeStationId)
        : undefined;
      if (!fromNodeId || !backNodeId) {
        skipped.push({
          timelineRow: timeline.row,
          reason: `停放前後的站在拓樸上找不到節點（${parkedStationId ?? '?'} / ${resumeStationId ?? '?'}）`,
        });
        continue;
      }

      let chosen: {
        nodeId: string;
        label: string;
        inSeconds: number;
        outSeconds: number;
      } | null = null;
      for (const facility of parkingNodes) {
        const pathIn = findTopologyPath(topology, fromNodeId, facility.id);
        const pathOut = findTopologyPath(topology, facility.id, backNodeId);
        if (!pathIn || !pathOut) continue;
        // 進得去、出得來，而且來回塞得進這段空檔才有意義
        if (pathIn.avgSeconds + pathOut.avgSeconds >= idleSeconds) continue;
        const parkStart = freeSecond + pathIn.avgSeconds;
        const parkEnd = nextStartSecond - pathOut.avgSeconds;
        if (!moveCardFacilityIsFree(bookings, facility.id, parkStart, parkEnd, timeline.row)) {
          continue;
        }
        const total = pathIn.avgSeconds + pathOut.avgSeconds;
        if (!chosen || total < chosen.inSeconds + chosen.outSeconds) {
          chosen = {
            nodeId: facility.id,
            label: facility.label || facility.id,
            inSeconds: pathIn.avgSeconds,
            outSeconds: pathOut.avgSeconds,
          };
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          reason: '拓樸上進不去或出不來任何一座調度設施，或設施都被別列車佔著',
        });
        continue;
      }

      const parkStart = freeSecond + chosen.inSeconds;
      const parkEnd = nextStartSecond - chosen.outSeconds;
      const parkingSectionCode = sectionCodes?.parking?.trim() || undefined;

      const pi: GeneratedScheduleBlock = {
        id: `parkin-${before.id}-${Math.round(freeSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `調度入廠 · → ${chosen.label}`,
        anchorStartMinute: secondToMinute(freeSecond),
        plannedStartMinute: secondToMinute(freeSecond),
        plannedEndMinute: secondToMinute(parkStart),
        travelSeconds: chosen.inSeconds,
        dwellSeconds: 0,
        source: 'park_entry_move',
        moveCardTag: 'PI',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: parkedStationId,
        yardExitSectionCode: parkingSectionCode,
      };
      const po: GeneratedScheduleBlock = {
        id: `parkout-${after.id}-${Math.round(parkEnd)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `調度出廠 · ${chosen.label} →`,
        anchorStartMinute: secondToMinute(parkEnd),
        plannedStartMinute: secondToMinute(parkEnd),
        plannedEndMinute: secondToMinute(nextStartSecond),
        travelSeconds: chosen.outSeconds,
        dwellSeconds: 0,
        source: 'park_exit_move',
        moveCardTag: 'PO',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: resumeStationId,
        yardExitSectionCode: parkingSectionCode,
      };
      timeline.blocks.push(pi, po);
      bookings.push({
        facilityNodeId: chosen.nodeId,
        startSecond: parkStart,
        endSecond: parkEnd,
        timelineRow: timeline.row,
      });
      inserted += 1;
    }
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return { timelines, inserted, skipped };
}
