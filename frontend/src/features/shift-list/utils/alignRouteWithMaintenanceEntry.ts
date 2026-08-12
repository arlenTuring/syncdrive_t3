/**
 * 要去充電，就把最後一趟開到進得了廠的那一站。
 * ================================================
 *
 * <strong>決策樹的另一個方向。</strong>先前有兩條：待命遷就路線、路線遷就待命。
 * 這一條是<strong>路線遷就整備</strong>——車跑完最後一趟正線之後要進廠，但它停的
 * 那一站在路網拓樸上<strong>到不了任何一台設施</strong>，於是入廠卡排不出來，
 * 畫面上就是一段沒有入廠卡、憑空開始的整備。
 *
 * 使用者的原話（2026-08-12）：「我還是不能接受他知道要去充電，還非得要停、不能
 * 移動過去充電樁……如果今天讓第五列車因為他要充電，所以到了 N2W上行出發 去趕快
 * 進場充電，我相信就能解決轉場卡的問題。」
 *
 * <strong>為什麼這裡可以換終點站，別的地方不行。</strong>一般換線時終點站是碰不得的：
 * 終點一變，下一趟的起點跟著變，會沿著交路一路歪下去（見
 * alignRouteWithVehicleLocation）。但這一趟的下一段是<strong>整備</strong>——
 * 車進了廠，再出來時的起點站由<strong>設施的出場站</strong>決定，跟這一趟的終點
 * 完全無關。所以「為了進廠而換終點」不會弄歪任何東西，是這條規則成立的前提。
 *
 * 只換起點相同的路線：車就在那裡，起點一變它根本開不了那一趟。
 *
 * 放在收斂迴圈<strong>裡面</strong>：設施在迴圈之前就決定好了，入廠卡在迴圈之後才插，
 * 中間這段正是唯一能改路線、又還來得及讓站位求解反應的位置。
 */
import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { findTopologyPath } from './findTopologyPath';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GeneratedScheduleBlock,
} from './schedule-engine/types';

const YARD_TASK_TYPES = new Set(['charging', 'servicing', 'inspection', 'standby']);

function routeOriginStationId(route: ShiftScheduleSelectedRoute): string | null {
  return route.stationIds?.[0]?.trim() || null;
}

function routeDestinationStationId(route: ShiftScheduleSelectedRoute): string | null {
  const ids = route.stationIds ?? [];
  return ids[ids.length - 1]?.trim() || null;
}

function stationDisplayName(
  stationId: string,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): string {
  for (const route of selectedRoutes) {
    const name = route.stationDwells?.find((d) => d.stationId === stationId)?.stationName?.trim();
    if (name) return name;
  }
  return stationId;
}

export function alignRouteWithMaintenanceEntry(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  topology?: PointTopology | null;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { swapped: number } {
  const { timelines, selectedRoutes, topology, warnings } = args;
  if (!topology) return { swapped: 0 };

  const nodeIdByStationId = new Map(
    (topology.nodes ?? [])
      .filter((node) => node.stationId?.trim())
      .map((node) => [node.stationId!.trim(), node.id] as const),
  );

  let swapped = 0;
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType) || yard.source !== 'template_bar') continue;
      const facilityNodeId = yard.yardFacilityNodeId?.trim();
      if (!facilityNodeId) continue;

      // 往前找同一列最近的那一趟正線——車就是從那裡開進廠的
      let previous: GeneratedScheduleBlock | undefined;
      for (let step = 1; step < sorted.length; step += 1) {
        const candidate = sorted[(i - step + sorted.length) % sorted.length]!;
        if (YARD_TASK_TYPES.has(candidate.taskType)) break;
        if (candidate.taskType === 'passenger' && candidate.source === 'template_bar') {
          previous = candidate;
          break;
        }
      }
      if (!previous) continue;

      const currentRoute = resolveRouteForBlock(previous, selectedRoutes);
      if (!currentRoute) continue;
      const currentDestination = routeDestinationStationId(currentRoute);
      if (!currentDestination) continue;

      // 現在停的地方進得了廠就不用動
      const currentNodeId = nodeIdByStationId.get(currentDestination);
      if (currentNodeId && findTopologyPath(topology, currentNodeId, facilityNodeId)) continue;

      const origin = routeOriginStationId(currentRoute);
      if (!origin) continue;

      let replacement: ShiftScheduleSelectedRoute | null = null;
      for (const candidate of selectedRoutes) {
        if (candidate.routeId === currentRoute.routeId) continue;
        // 車就在起點站，起點一變它根本開不了那一趟
        if (routeOriginStationId(candidate) !== origin) continue;
        const destination = routeDestinationStationId(candidate);
        if (!destination || destination === currentDestination) continue;
        const nodeId = nodeIdByStationId.get(destination);
        if (!nodeId) continue;
        if (!findTopologyPath(topology, nodeId, facilityNodeId)) continue;
        replacement = candidate;
        break;
      }
      if (!replacement) continue;

      const fromLabel = currentRoute.routeCode ?? currentRoute.routeName ?? currentRoute.routeId;
      const toLabel = replacement.routeCode ?? replacement.routeName ?? replacement.routeId;
      previous.routeId = replacement.routeId;
      previous.routeInstanceId = replacement.instanceId ?? replacement.routeId;
      previous.routeCode = replacement.routeCode ?? previous.routeCode;
      previous.routeName = replacement.routeName ?? previous.routeName;
      swapped += 1;

      warnings?.push({
        code: 'ROUTE_ALIGNED_TO_MAINTENANCE_ENTRY',
        severity: 'warning',
        kind: 'policy',
        message:
          `時間線 ${timeline.row}：進廠前那一趟原本開到`
          + `「${stationDisplayName(currentDestination, selectedRoutes)}」，`
          + `而那一站在拓樸上到不了 ${yard.yardFacilityLabel ?? facilityNodeId}，入廠卡排不出來。`
          + `已改跑同起點的「${toLabel}」（原本是「${fromLabel}」），`
          + `終點換成進得了廠的那一站——下一段是整備，出場站由設施決定，交路不會歪。`,
        detail: {
          timelineRow: timeline.row,
          blockId: previous.id,
          yardBlockId: yard.id,
          facilityNodeId,
          fromRouteId: currentRoute.routeId,
          toRouteId: replacement.routeId,
        },
      });
    }
  }
  return { swapped };
}
