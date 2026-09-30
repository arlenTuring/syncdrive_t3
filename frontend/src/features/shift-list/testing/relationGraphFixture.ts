import type { ShiftScheduleCreateDraft, ShiftScheduleSelectedRoute } from '../types/create';
import { resolveSelectedRouteInstanceId } from '../types/create';
import type { ShiftRouteRelationGraph } from '../utils/routeRelationGraph';
import {
  buildThroughVerificationFingerprint,
  computeRouteThroughPaths,
  emptyShiftRouteThroughAnchorsDraft,
} from '../utils/routeRelationThroughCycles';

/**
 * 測試用：替路線群組畫一張「依列出順序接下去」的關聯圖，並把路線組合標成已驗證。
 *
 * 引擎不再自己依排列順序輪替（白皮書 ROUTE-02），沒有關聯圖就不生成。測其他規則的測試
 * 要先像使用者一樣畫好關聯圖：第 1 條接第 2 條……最後一條為一輪結束，從第 1 條起算。
 * 前一條終點站必須等於下一條起點站，否則關聯圖本身不合法（跟正式畫面同一套檢查）。
 *
 * 已經有關聯圖的草稿不動。
 */
export function withListedOrderRelationGraph(
  routeGroups: ShiftScheduleCreateDraft['routeGroups'],
): ShiftScheduleCreateDraft['routeGroups'] {
  if ((routeGroups.routeRelationGraph?.links?.length ?? 0) > 0) return routeGroups;
  const routes = [...routeGroups.selectedRoutes]
    .filter((route) => !route.backupForInstanceId && !route.backupForRouteId)
    .sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
  if (routes.length === 0) return routeGroups;
  const ids = routes.map((route) => resolveSelectedRouteInstanceId(route));
  // 一輪結束接回第一條（終點站＝起點站時才畫；跟正式畫面一樣，接不上的連線不合法）
  const closes = routes.length > 1
    && routes[routes.length - 1]!.stationIds[routes[routes.length - 1]!.stationIds.length - 1] === routes[0]!.stationIds[0];
  const graph: ShiftRouteRelationGraph = {
    nodes: ids.map((instanceId, index) => ({ instanceId, x: index * 200, y: 0 })),
    links: [
      ...ids.slice(0, -1).map((from, index) => ({
        id: `rel:${from}->${ids[index + 1]}`,
        fromInstanceId: from,
        toInstanceId: ids[index + 1]!,
        nextKind: 'priority' as const,
      })),
      ...(closes ? [{ id: `rel:${ids[ids.length - 1]}->${ids[0]}`, fromInstanceId: ids[ids.length - 1]!, toInstanceId: ids[0]!, nextKind: 'priority' as const }] : []),
    ],
  };
  const startInstanceIds = [ids[0]!];
  const endInstanceIds = [ids[ids.length - 1]!];
  const cycles = computeRouteThroughPaths({
    startInstanceIds,
    endInstanceIds,
    routes: routeGroups.selectedRoutes as ShiftScheduleSelectedRoute[],
    graph,
    minimumRecoveryTimeSeconds: routeGroups.minimumRecoveryTimeSeconds,
  });
  const fingerprint = buildThroughVerificationFingerprint({
    startInstanceIds,
    endInstanceIds,
    routes: routeGroups.selectedRoutes as ShiftScheduleSelectedRoute[],
    graph,
    minimumRecoveryTimeSeconds: routeGroups.minimumRecoveryTimeSeconds,
  });
  return {
    ...routeGroups,
    routeRelationGraph: graph,
    throughAnchors: {
      ...emptyShiftRouteThroughAnchorsDraft(),
      startInstanceIds,
      endInstanceIds,
      verifiedFingerprint: cycles.length > 0 ? fingerprint : null,
      verifiedPathCount: cycles.length,
      preferredThroughCycleId: cycles[0]?.id ?? null,
      listedThroughCycles: cycles,
      listedFingerprint: fingerprint,
    },
  };
}

/**
 * 測試用：把「各自一組私有起訖站」的測試路線接成一個環（第 i 條終點＝第 i+1 條起點，最後一條接回第一條）。
 *
 * 舊測試的路線站點各自獨立（例如 r1-origin → r1-terminal），以前靠引擎依排列順序硬接；現在正線接續只依
 * 關聯圖，而關聯圖要求終點站＝下一條起點站。只改站點代號，行駛與停靠秒數不動。
 */
export function connectListedRoutesIntoLoop<T extends { stationIds: string[]; stationDwells: Array<{ stationId: string }> }>(
  routes: T[],
): T[] {
  if (routes.length <= 1) return routes;
  const connected = routes.every((route, index) => {
    const next = routes[(index + 1) % routes.length]!;
    return route.stationIds[route.stationIds.length - 1] === next.stationIds[0];
  });
  if (connected) return routes;
  const junction = (index: number) => `loop-station-${index % routes.length}`;
  return routes.map((route, index) => {
    const from = junction(index);
    const to = junction(index + 1);
    const originalFrom = route.stationIds[0];
    const originalTo = route.stationIds[route.stationIds.length - 1];
    const rename = (id: string) => (id === originalFrom ? from : id === originalTo ? to : id);
    return {
      ...route,
      stationIds: route.stationIds.map(rename),
      stationDwells: route.stationDwells.map((dwell) => ({ ...dwell, stationId: rename(dwell.stationId) })),
    };
  });
}
