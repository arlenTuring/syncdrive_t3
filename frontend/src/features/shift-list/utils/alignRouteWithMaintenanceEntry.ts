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
import {
  resolveSelectedRouteInstanceId,
  type ShiftScheduleSelectedRoute,
} from '../types/create';
import { findTopologyPath } from './findTopologyPath';
import { resolveRouteForBlock } from './buildBlockStationDepartures';
import {
  listNextInstanceCandidates,
  type RouteSuccessorPolicy,
} from './schedule-engine/routeSuccessorPolicy';
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
  /** 換過去的路線必須仍是關聯圖上的合法出邊，否則會踩到 ROUTE_SUCCESSOR_MISMATCH（error） */
  successorPolicy?: RouteSuccessorPolicy | null;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { swapped: number } {
  const { timelines, selectedRoutes, topology, successorPolicy, warnings } = args;
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
      /**
       * <strong>待命不算，車停在正線站位上的也不算。</strong>
       *
       * 這條規則能成立，靠的是「車進了廠，出來時的起點站由設施的出場站決定，
       * 跟這一趟的終點無關」。<strong>待命根本沒進廠</strong>——車就停在原地，
       * 下一趟的起點就是它站的那一站；把前一趟的終點換掉，下一趟就接不上了。
       *
       * 實測（2026-08-12 使用者的 log）：放行待命之後冒出
       * <code>ROUTE_STATION_DISCONTINUITY</code> 4 則與
       * <code>ROUTE_SUCCESSOR_MISMATCH</code> 4 則，兩者都是 error。
       * 前提寫對了，卻沒有逐條檢查它的適用範圍，就是這個下場。
       *
       * 同理，停在<strong>正線停靠站</strong>的整備（<code>yardFacilityStationId</code>
       * 有值）也不算：那是站位不是廠，車沒有被設施接手。
       */
      if (yard.taskType === 'standby') continue;
      if (yard.yardFacilityStationId?.trim()) continue;
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

      /**
       * <strong>換過去的那一條必須仍是關聯圖上的合法出邊。</strong>
       *
       * 第一版只比對起點站就換，完全沒問關聯圖——而
       * <code>ROUTE_SUCCESSOR_MISMATCH</code> 是<strong>error 不是 warning</strong>，
       * 換錯會把整張班表打成不可用。重現資料沒踩到只是運氣
       * （2026-08-12 使用者要求檢查：「你現在這個算法是成立的嗎？是有開放束縛的嗎」）。
       *
       * 判準跟驗證用的是<strong>同一份</strong>：前一趟的合法出邊集合
       * （含次要邊）。前面沒有正線可比時不設限——那是開輪，本來就沒有上游可違反。
       */
      let allowedNextIds: Set<string> | null = null;
      if (successorPolicy?.valid) {
        const previousIndex = sorted.indexOf(previous);
        for (let step = 1; step < sorted.length; step += 1) {
          const earlier = sorted[(previousIndex - step + sorted.length) % sorted.length]!;
          if (YARD_TASK_TYPES.has(earlier.taskType)) break;
          if (earlier.taskType !== 'passenger' || earlier.source !== 'template_bar') continue;
          const earlierRoute = resolveRouteForBlock(earlier, selectedRoutes);
          if (!earlierRoute) break;
          allowedNextIds = new Set(
            listNextInstanceCandidates(
              successorPolicy,
              resolveSelectedRouteInstanceId(earlierRoute),
              { allowSecondary: true },
            ).map((item) => item.instanceId),
          );
          break;
        }
      }

      /**
       * 挑<strong>路徑最短</strong>的那一條，不是第一個湊合的。
       * 「進得了廠」通常不只一條，隨手抓一條會讓車繞遠路空跑。
       */
      let replacement: ShiftScheduleSelectedRoute | null = null;
      let replacementSeconds = Number.POSITIVE_INFINITY;
      for (const candidate of selectedRoutes) {
        if (candidate.routeId === currentRoute.routeId) continue;
        // 車就在起點站，起點一變它根本開不了那一趟——這是物理，不是偏好
        if (routeOriginStationId(candidate) !== origin) continue;
        const destination = routeDestinationStationId(candidate);
        if (!destination || destination === currentDestination) continue;
        if (allowedNextIds && !allowedNextIds.has(resolveSelectedRouteInstanceId(candidate))) {
          continue;
        }
        const nodeId = nodeIdByStationId.get(destination);
        if (!nodeId) continue;
        const path = findTopologyPath(topology, nodeId, facilityNodeId);
        if (!path) continue;
        if (path.avgSeconds < replacementSeconds) {
          replacement = candidate;
          replacementSeconds = path.avgSeconds;
        }
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
