import type { ShiftScheduleSelectedRoute } from '../types/create';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import type { RouteSuccessorPolicy } from './schedule-engine/routeSuccessorPolicy';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GeneratedScheduleBlock,
} from './schedule-engine/types';

/**
 * 車停在哪，下一班就從那裡發
 * ==========================
 *
 * <strong>決策樹的第三條路。</strong>先前只有兩級讓步：
 *
 * <ol>
 *   <li><strong>待命遷就路線</strong>——挑停放地點時看下一段要去哪；</li>
 *   <li><strong>路線遷就待命</strong>——就是這一支。</li>
 * </ol>
 *
 * 為什麼需要它：待命的停放地點是被<strong>站位限制夾出來的</strong>，常常沒得選
 * （主線那一格整天有車經過，只好退到備用格）；而路線在主線與備用之間<strong>本來
 * 就是可選的</strong>。該讓的是有選擇的那一方。
 *
 * 實際看到的荒謬情形：待命停在「[備用]N2W下行出發」，下一班卻被指派了從
 * 「N2W下行出發」出發的主線路線——車得先空跑過去，只為了跑一班本來可以就地
 * 出發的車。兩個子系統各自都合理，合起來不合理：路線在流水線第一步就定案，
 * 那時待命還沒決定停哪；而待命決定之後，沒有任何機制回頭通知路線。
 *
 * 換線的條件很嚴：
 * <ul>
 *   <li>候選必須是<strong>前一段載客在關聯圖上的後繼</strong>——不是隨便挑一條，
 *       是這個位置本來就可以接的那幾條；</li>
 *   <li>候選的<strong>終點站必須相同</strong>——終點一變，下一段的起點跟著變，
 *       會沿著交路一路歪下去。只換起點（也就是只換用哪一格站位）是安全的；</li>
 *   <li>候選的起點必須<strong>正好是車現在停的地方</strong>。</li>
 * </ul>
 *
 * 放在幾何收斂迴圈<strong>裡面</strong>：換路線＝換停靠站，可能製造新的站位碰撞，
 * 必須讓站位求解有機會反應。放在迴圈後面就變成無人收拾的改動。
 */

/**
 * 依日循環往回找上一個區塊。
 *
 * 班表是一個循環：19:38–24:00 的待命，接的是 00:11 的班次。但照
 * <code>plannedStartMinute</code> 線性排序時，00:11 那張排在陣列<strong>最前面</strong>、
 * 待命排在<strong>最後面</strong>——直接取 <code>sorted[i - 1]</code> 會拿到清晨的某張卡，
 * 跨午夜的待命<strong>一律漏掉</strong>。而需要改派路線的，偏偏多半就是跨午夜那幾段
 * （2026-08-11：SB1938 就是這樣沒被處理到）。
 */
function previousCyclic<T>(sorted: T[], index: number): T | null {
  if (sorted.length === 0) return null;
  return sorted[(index - 1 + sorted.length) % sorted.length] ?? null;
}

/** 車在這一段整備結束時實際停在哪一個站（停設施格的話沒有站，回 null） */
function parkedStationIdOf(block: GeneratedScheduleBlock): string | null {
  return block.yardFacilityStationId?.trim() || null;
}

function routeOriginStationId(route: ShiftScheduleSelectedRoute): string | null {
  return route.stationIds?.[0]?.trim() || null;
}

function routeDestinationStationId(route: ShiftScheduleSelectedRoute): string | null {
  const ids = route.stationIds ?? [];
  return ids[ids.length - 1]?.trim() || null;
}

/** 站點 id → 使用者看得懂的站名（路線設定裡就有）；查不到才退回 id */
function stationDisplayName(
  stationId: string,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): string {
  for (const route of selectedRoutes) {
    const dwell = route.stationDwells?.find((item) => item.stationId === stationId);
    const name = dwell?.stationName?.trim();
    if (name) return name;
  }
  return stationId;
}

function instanceIdOf(
  block: GeneratedScheduleBlock,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): string | null {
  const trimmed = block.routeInstanceId?.trim();
  if (trimmed) return trimmed;
  const route = resolveRouteForBlock(block, selectedRoutes);
  return route ? route.instanceId?.trim() || route.routeId : null;
}

/** 關聯圖上這個節點的全部出邊（優先在前、次要在後） */
function listGraphSuccessorIds(
  successorPolicy: RouteSuccessorPolicy,
  instanceId: string,
): string[] {
  return [
    ...(successorPolicy.prioritySuccessors.get(instanceId) ?? []),
    ...(successorPolicy.secondarySuccessors.get(instanceId) ?? []),
  ];
}

export function alignRouteWithVehicleLocation(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  successorPolicy?: RouteSuccessorPolicy | null;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { swapped: number } {
  const { timelines, selectedRoutes, successorPolicy, warnings } = args;
  if (!successorPolicy) return { swapped: 0 };

  let swapped = 0;
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const block = sorted[i]!;
      if (block.taskType !== 'passenger') continue;

      // 前一段是不是「車停在某個站位」的整備？停設施格就沒有站位可談
      const previous = previousCyclic(sorted, i);
      if (!previous || previous === block) continue;
      const parkedStationId = parkedStationIdOf(previous);
      if (!parkedStationId) continue;

      const currentRoute = resolveRouteForBlock(block, selectedRoutes);
      if (!currentRoute) continue;
      const currentOrigin = routeOriginStationId(currentRoute);
      // 已經從車停的地方出發，不用動
      if (!currentOrigin || currentOrigin === parkedStationId) continue;

      // 候選只能從「前一段載客的後繼」裡挑——那是這個位置本來就接得上的
      // 往回找最近一段載客，也要照日循環繞回去
      let previousPassenger: GeneratedScheduleBlock | null = null;
      for (let step = 1; step <= sorted.length; step += 1) {
        const candidate = sorted[(i - step + sorted.length * 2) % sorted.length]!;
        if (candidate === block) break;
        if (candidate.taskType === 'passenger') { previousPassenger = candidate; break; }
      }
      if (!previousPassenger) continue;
      const previousInstanceId = instanceIdOf(previousPassenger, selectedRoutes);
      if (!previousInstanceId) continue;

      const currentDestination = routeDestinationStationId(currentRoute);
      let replacement: { instanceId: string; route: ShiftScheduleSelectedRoute } | null = null;
      for (const candidateId of listGraphSuccessorIds(successorPolicy, previousInstanceId)) {
        const candidate = successorPolicy.routesByInstanceId.get(candidateId);
        if (!candidate) continue;
        if (routeOriginStationId(candidate) !== parkedStationId) continue;
        // 終點一變，下一段的起點跟著變，會沿著交路一路歪下去
        if (routeDestinationStationId(candidate) !== currentDestination) continue;
        replacement = { instanceId: candidateId, route: candidate };
        break;
      }
      if (!replacement) {
        /**
         * 想換卻換不成——車停在 A、下一班卻要從 B 發，而關聯圖上「前一段之後」
         * 沒有任何一條同終點、從 A 出發的路線可接。
         *
         * 這時車一定要空跑一段。先前這裡是<strong>直接 continue</strong>：
         * 畫面上只看得到「待命點跟出發點不一樣」，看不出原因、也不知道能改哪裡
         * （2026-08-11 使用者連續三輪回報 SB1938）。原因其實很明確，而且是
         * 使用者改得動的：關聯圖上補一條邊就好。
         */
        warnings?.push({
          code: 'ROUTE_ORIGIN_AWAY_FROM_VEHICLE',
          severity: 'warning',
          kind: 'actionable',
          message:
            `時間線 ${timeline.row}：車停在「${stationDisplayName(parkedStationId, selectedRoutes)}」，`
            + `下一班「${currentRoute.routeName ?? currentRoute.routeId}」卻從`
            + `「${stationDisplayName(currentOrigin, selectedRoutes)}」出發，中間得空跑一段。`
            + `關聯圖上「${previousPassenger.routeName ?? previousInstanceId}」之後，`
            + `沒有同終點、又從車所在位置出發的路線可接——補上那條邊就能省掉這段空跑。`,
          detail: {
            timelineRow: timeline.row,
            blockId: block.id,
            parkedStationId,
            routeId: currentRoute.routeId,
            previousRouteId: previousPassenger.routeId,
          },
        });
        continue;
      }

      block.routeId = replacement.route.routeId;
      block.routeInstanceId = replacement.instanceId;
      block.routeCode = replacement.route.routeCode ?? block.routeCode;
      block.routeName = replacement.route.routeName ?? block.routeName;
      swapped += 1;

      warnings?.push({
        code: 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION',
        severity: 'warning',
        kind: 'policy',
        message:
          `時間線 ${timeline.row}：車停在「${stationDisplayName(parkedStationId, selectedRoutes)}」，`
          + `原本卻要跑從別站出發的「${currentRoute.routeName ?? currentRoute.routeId}」——`
          + `已改派同終點、從車所在位置出發的「${replacement.route.routeName ?? replacement.route.routeId}」，`
          + `省掉一段空跑。`,
        detail: {
          timelineRow: timeline.row,
          blockId: block.id,
          parkedStationId,
          fromRouteId: currentRoute.routeId,
          toRouteId: replacement.route.routeId,
        },
      });
    }
  }
  return { swapped };
}
