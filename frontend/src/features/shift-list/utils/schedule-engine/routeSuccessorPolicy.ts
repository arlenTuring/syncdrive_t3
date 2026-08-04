/**
 * 路線繼任策略：把 Step 4 關聯圖 + 折返錨點轉成排班引擎可用的輪替環。
 *
 * - `relation-graph-through-anchors-v1`：以已鎖定的**全優先**折返組合為硬輪替環；
 *   引擎只走這組，不另找次要或其他走法。
 * - `execution-order-ring-v1`：完全沒有關聯圖時才用執行順序硬輪替（相容舊資料）。
 */

import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveSelectedRouteInstanceId } from '../../types/create';
import {
  emptyShiftRouteRelationGraph,
  resolveRouteOriginStation,
  resolveRouteTerminalStation,
  type ShiftRouteRelationGraph,
} from '../routeRelationGraph';
import {
  computeRouteThroughPaths,
  emptyShiftRouteThroughAnchorsDraft,
  isThroughVerificationCurrent,
  type RouteThroughCycle,
  type ShiftRouteThroughAnchorsDraft,
} from '../routeRelationThroughCycles';
import {
  normalizeMinimumRecoveryTimeSeconds,
  resolveInterTripGapSeconds,
  resolvePassengerRouteOccupancy,
  shouldIncludeRecoveryForRouteSwitch,
} from './physics';

export const ROUTE_SUCCESSOR_ALGORITHM_GRAPH =
  'relation-graph-through-anchors-v1' as const;
export const ROUTE_SUCCESSOR_ALGORITHM_RING = 'execution-order-ring-v1' as const;
export const ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH =
  'invalid-relation-graph-v1' as const;

export type RouteSuccessorAlgorithm =
  | typeof ROUTE_SUCCESSOR_ALGORITHM_GRAPH
  | typeof ROUTE_SUCCESSOR_ALGORITHM_RING
  | typeof ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH;

export type RouteSuccessorPolicyIssue =
  | 'THROUGH_VERIFICATION_INVALID'
  | 'NO_PRIORITY_THROUGH_PATH'
  | 'THROUGH_PATH_ROUTE_MISSING';

export type RouteSuccessorPolicy = {
  algorithm: RouteSuccessorAlgorithm;
  /** 有圖但無法建立可信 successor 時為 false；呼叫端必須當 fatal issue 處理。 */
  valid: boolean;
  issue?: RouteSuccessorPolicyIssue;
  routesByInstanceId: Map<string, ShiftScheduleSelectedRoute>;
  /** 輪替用有序列表（graph＝參考導通；ring＝executionOrder） */
  rotationRoutes: ShiftScheduleSelectedRoute[];
  prioritySuccessors: Map<string, string[]>;
  secondarySuccessors: Map<string, string[]>;
  startInstanceIds: string[];
  endInstanceIds: Set<string>;
  canonicalCycleInstanceIds: string[];
  throughCycles: RouteThroughCycle[];
};

function occupancySeconds(route: ShiftScheduleSelectedRoute): number {
  return resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? 0;
}

function pickCanonicalCycle(cycles: RouteThroughCycle[]): RouteThroughCycle | null {
  if (cycles.length === 0) return null;
  const priorityOnly = cycles.filter((item) => item.secondaryCount === 0);
  const pool = priorityOnly.length > 0 ? priorityOnly : [];
  // 圖模式只採全優先；若無全優先則不建圖策略（由呼叫端退回 ring）
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    if (a.minCycleSeconds !== b.minCycleSeconds) {
      return a.minCycleSeconds - b.minCycleSeconds;
    }
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

function buildRingPolicy(
  routes: ShiftScheduleSelectedRoute[],
): RouteSuccessorPolicy {
  const routesByInstanceId = new Map(
    routes.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
  );
  const instanceIds = routes.map((route) => resolveSelectedRouteInstanceId(route));
  const prioritySuccessors = new Map<string, string[]>();
  for (let i = 0; i < instanceIds.length; i += 1) {
    const from = instanceIds[i]!;
    const to = instanceIds[(i + 1) % instanceIds.length]!;
    prioritySuccessors.set(from, instanceIds.length > 1 ? [to] : []);
  }
  return {
    algorithm: ROUTE_SUCCESSOR_ALGORITHM_RING,
    valid: true,
    routesByInstanceId,
    rotationRoutes: routes,
    prioritySuccessors,
    secondarySuccessors: new Map(),
    startInstanceIds: instanceIds.length > 0 ? [instanceIds[0]!] : [],
    endInstanceIds: new Set(
      instanceIds.length > 0 ? [instanceIds[instanceIds.length - 1]!] : [],
    ),
    canonicalCycleInstanceIds: instanceIds,
    throughCycles: [],
  };
}

function buildInvalidGraphPolicy(
  routes: ShiftScheduleSelectedRoute[],
  issue: RouteSuccessorPolicyIssue,
): RouteSuccessorPolicy {
  return {
    algorithm: ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH,
    valid: false,
    issue,
    routesByInstanceId: new Map(
      routes.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
    ),
    // 禁止有圖卻用 executionOrder 繼續產班。
    rotationRoutes: [],
    prioritySuccessors: new Map(),
    secondarySuccessors: new Map(),
    startInstanceIds: [],
    endInstanceIds: new Set(),
    canonicalCycleInstanceIds: [],
    throughCycles: [],
  };
}

/**
 * 由 Step 4 關聯圖／折返錨點建立繼任策略。
 * 只有完全沒有關聯圖時才退回執行順序環；有圖但驗證無效時回傳 invalid policy。
 */
export function buildRouteSuccessorPolicy(input: {
  routes: ShiftScheduleSelectedRoute[];
  graph?: ShiftRouteRelationGraph | null;
  throughAnchors?: ShiftRouteThroughAnchorsDraft | null;
  minimumRecoveryTimeSeconds?: number | null;
}): RouteSuccessorPolicy {
  const routes = input.routes;
  const ring = buildRingPolicy(routes);
  const graph = input.graph ?? emptyShiftRouteRelationGraph();
  if (routes.length === 0) {
    return graph.links.length > 0
      ? buildInvalidGraphPolicy(routes, 'THROUGH_VERIFICATION_INVALID')
      : ring;
  }
  const anchors = input.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
  const recovery = normalizeMinimumRecoveryTimeSeconds(
    input.minimumRecoveryTimeSeconds ?? 0,
  );

  const verified = isThroughVerificationCurrent({
    anchors,
    routes,
    graph,
    minimumRecoveryTimeSeconds: recovery,
  });
  if (graph.links.length === 0) return ring;
  if (!verified) {
    return buildInvalidGraphPolicy(routes, 'THROUGH_VERIFICATION_INVALID');
  }

  const throughCycles = computeRouteThroughPaths({
    startStationIds: anchors.startStationIds,
    endStationIds: anchors.endStationIds,
    startInstanceIds: anchors.startInstanceIds,
    endInstanceIds: anchors.endInstanceIds,
    routes,
    graph,
    minimumRecoveryTimeSeconds: recovery,
  });
  const priorityCycles = throughCycles.filter((item) => item.secondaryCount === 0);
  const canonical = pickCanonicalCycle(priorityCycles);
  if (!canonical || canonical.instanceIds.length === 0) {
    return buildInvalidGraphPolicy(routes, 'NO_PRIORITY_THROUGH_PATH');
  }

  const routesByInstanceId = new Map(
    routes.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
  );
  const rotationRoutes = canonical.instanceIds
    .map((id) => routesByInstanceId.get(id))
    .filter((route): route is ShiftScheduleSelectedRoute => Boolean(route));
  if (rotationRoutes.length !== canonical.instanceIds.length) {
    return buildInvalidGraphPolicy(routes, 'THROUGH_PATH_ROUTE_MISSING');
  }

  // 只沿鎖定組合建優先繼任；次要連線不進入排班走法
  const prioritySuccessors = new Map<string, string[]>();
  for (let i = 0; i < canonical.instanceIds.length - 1; i += 1) {
    const from = canonical.instanceIds[i]!;
    const to = canonical.instanceIds[i + 1]!;
    prioritySuccessors.set(from, [to]);
  }

  const startInstanceIds: string[] =
    anchors.startInstanceIds.length > 0
      ? [...anchors.startInstanceIds]
      : [];
  const endInstanceIds = new Set(
    anchors.endInstanceIds.length > 0
      ? anchors.endInstanceIds
      : [],
  );
  if (startInstanceIds.length === 0 || endInstanceIds.size === 0) {
    const startSet = new Set(anchors.startStationIds.map((id) => id.trim()).filter(Boolean));
    const endSet = new Set(anchors.endStationIds.map((id) => id.trim()).filter(Boolean));
    for (const route of routes) {
      const instanceId = resolveSelectedRouteInstanceId(route);
      const origin = resolveRouteOriginStation(route)?.stationId;
      const terminal = resolveRouteTerminalStation(route)?.stationId;
      if (origin && startSet.has(origin) && !startInstanceIds.includes(instanceId)) {
        startInstanceIds.push(instanceId);
      }
      if (terminal && endSet.has(terminal)) endInstanceIds.add(instanceId);
    }
  }
  const canonStart = canonical.instanceIds[0]!;
  const canonEnd = canonical.instanceIds[canonical.instanceIds.length - 1]!;
  // 無指定出場站的折返必須回到「實際採用 canonical」的起點，不能受 UI
  // 多起點選取順序影響而跳到另一條備用路線。
  const canonicalFirstStarts = [
    canonStart,
    ...startInstanceIds.filter((instanceId) => instanceId !== canonStart),
  ];
  endInstanceIds.add(canonEnd);

  return {
    algorithm: ROUTE_SUCCESSOR_ALGORITHM_GRAPH,
    valid: true,
    routesByInstanceId,
    rotationRoutes,
    prioritySuccessors,
    secondarySuccessors: new Map(),
    startInstanceIds: canonicalFirstStarts,
    endInstanceIds,
    canonicalCycleInstanceIds: [...canonical.instanceIds],
    throughCycles: priorityCycles,
  };
}

/** 出場站／開輪時挑選起始 instance */
export function resolveStartInstanceId(
  policy: RouteSuccessorPolicy,
  exitStationId?: string | null,
): string | null {
  if (!policy.valid) return null;
  if (policy.startInstanceIds.length === 0) {
    return policy.rotationRoutes[0]
      ? resolveSelectedRouteInstanceId(policy.rotationRoutes[0])
      : null;
  }
  const exit = exitStationId?.trim() || '';
  if (exit) {
    for (const instanceId of policy.startInstanceIds) {
      const route = policy.routesByInstanceId.get(instanceId);
      const origin = route ? resolveRouteOriginStation(route)?.stationId : null;
      if (origin === exit) return instanceId;
    }
    // 非 start 錨點：仍允許以出場站命中任一輪替路線起點
    for (const route of policy.rotationRoutes) {
      const origin = resolveRouteOriginStation(route)?.stationId;
      if (origin === exit) return resolveSelectedRouteInstanceId(route);
    }
  }
  return policy.startInstanceIds[0] ?? null;
}

export function resolveRouteIndexInRotation(
  policy: RouteSuccessorPolicy,
  instanceId: string,
): number {
  return policy.rotationRoutes.findIndex(
    (route) => resolveSelectedRouteInstanceId(route) === instanceId,
  );
}

/**
 * 由目前路線決定下一程。
 * 預設只走優先；`allowSecondary` 時優先皆不可用才改次要。
 * ring 模式等同執行順序下一條。
 */
export function resolveNextInstanceId(
  policy: RouteSuccessorPolicy,
  currentInstanceId: string,
  options?: { allowSecondary?: boolean },
): { instanceId: string; kind: 'priority' | 'secondary' | 'ring' } | null {
  if (!policy.valid) return null;
  const allowSecondary = options?.allowSecondary === true;

  if (policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_RING) {
    const index = resolveRouteIndexInRotation(policy, currentInstanceId);
    if (index < 0 || policy.rotationRoutes.length === 0) return null;
    const next =
      policy.rotationRoutes[(index + 1) % policy.rotationRoutes.length]!;
    return {
      instanceId: resolveSelectedRouteInstanceId(next),
      kind: 'ring',
    };
  }

  // 若剛跑完折返錨點路線，下一輪從頭開始
  if (policy.endInstanceIds.has(currentInstanceId)) {
    const start = resolveStartInstanceId(policy);
    if (!start) return null;
    return { instanceId: start, kind: 'priority' };
  }

  const priority = policy.prioritySuccessors.get(currentInstanceId) ?? [];
  if (priority.length > 0) {
    return { instanceId: priority[0]!, kind: 'priority' };
  }

  if (allowSecondary) {
    const secondary = policy.secondarySuccessors.get(currentInstanceId) ?? [];
    if (secondary.length > 0) {
      return { instanceId: secondary[0]!, kind: 'secondary' };
    }
  }

  // 圖缺邊時退回參考導通環
  const index = resolveRouteIndexInRotation(policy, currentInstanceId);
  if (index >= 0 && index < policy.rotationRoutes.length - 1) {
    return {
      instanceId: resolveSelectedRouteInstanceId(policy.rotationRoutes[index + 1]!),
      kind: 'priority',
    };
  }
  const start = resolveStartInstanceId(policy);
  return start ? { instanceId: start, kind: 'priority' } : null;
}

/** 列出可嘗試的下一程（優先在前、次要在後） */
export function listNextInstanceCandidates(
  policy: RouteSuccessorPolicy,
  currentInstanceId: string,
  options?: { allowSecondary?: boolean },
): Array<{ instanceId: string; kind: 'priority' | 'secondary' | 'ring' }> {
  const allowSecondary = options?.allowSecondary === true;
  if (policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_RING) {
    const next = resolveNextInstanceId(policy, currentInstanceId);
    return next ? [next] : [];
  }

  if (policy.endInstanceIds.has(currentInstanceId)) {
    const start = resolveStartInstanceId(policy);
    return start ? [{ instanceId: start, kind: 'priority' }] : [];
  }

  const out: Array<{ instanceId: string; kind: 'priority' | 'secondary' | 'ring' }> =
    [];
  for (const id of policy.prioritySuccessors.get(currentInstanceId) ?? []) {
    out.push({ instanceId: id, kind: 'priority' });
  }
  if (allowSecondary) {
    for (const id of policy.secondarySuccessors.get(currentInstanceId) ?? []) {
      if (!out.some((item) => item.instanceId === id)) {
        out.push({ instanceId: id, kind: 'secondary' });
      }
    }
  }
  if (out.length === 0) {
    const fallback = resolveNextInstanceId(policy, currentInstanceId, {
      allowSecondary,
    });
    if (fallback) out.push(fallback);
  }
  return out;
}

export function isCycleClosingInstance(
  policy: RouteSuccessorPolicy,
  instanceId: string,
): boolean {
  if (!policy.valid) return false;
  if (policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_RING) {
    if (policy.rotationRoutes.length <= 1) return true;
    const last = policy.rotationRoutes[policy.rotationRoutes.length - 1]!;
    return resolveSelectedRouteInstanceId(last) === instanceId;
  }
  return policy.endInstanceIds.has(instanceId);
}

/** 估從某一起點跑完一輪到折返錨點的剩餘占用秒數 */
export function estimatePolicyCycleSeconds(
  policy: RouteSuccessorPolicy,
  startInstanceId: string,
  minimumRecoveryTimeSeconds: number,
): number {
  const routes = policy.rotationRoutes;
  if (routes.length === 0) return 0;

  if (policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_RING) {
    const startIndex = Math.max(0, resolveRouteIndexInRotation(policy, startInstanceId));
    let total = 0;
    for (let hop = 0; hop < routes.length; hop += 1) {
      const index = (startIndex + hop) % routes.length;
      const route = routes[index]!;
      if (hop > 0) {
        const prev = routes[(startIndex + hop - 1) % routes.length]!;
        total += resolveInterTripGapSeconds({
          minimumRecoveryTimeSeconds,
          previousRouteSwitchBufferSeconds: prev.switchBufferAfterSeconds,
          isRouteSwitch: prev.routeId !== route.routeId,
          includeRecovery: shouldIncludeRecoveryForRouteSwitch({
            previousRoute: prev,
            nextRoute: route,
            rotationRoutes: routes,
          }),
          previousRoute: prev,
          nextRoute: route,
        });
      }
      total += occupancySeconds(route);
    }
    return total;
  }

  // 圖模式：自鎖定全優先組合上的起點走到該輪終點（不繞回）
  const ids = policy.canonicalCycleInstanceIds;
  let startIndex = ids.indexOf(startInstanceId);
  if (startIndex < 0) startIndex = 0;
  let total = 0;
  let prevRoute: ShiftScheduleSelectedRoute | null = null;
  for (let i = startIndex; i < ids.length; i += 1) {
    const route = policy.routesByInstanceId.get(ids[i]!);
    if (!route) continue;
    if (prevRoute) {
      total += resolveInterTripGapSeconds({
        minimumRecoveryTimeSeconds,
        previousRouteSwitchBufferSeconds: prevRoute.switchBufferAfterSeconds,
        isRouteSwitch: prevRoute.routeId !== route.routeId,
        includeRecovery: shouldIncludeRecoveryForRouteSwitch({
          previousRoute: prevRoute,
          nextRoute: route,
          rotationRoutes: policy.rotationRoutes,
        }),
        previousRoute: prevRoute,
        nextRoute: route,
      });
    }
    total += occupancySeconds(route);
    prevRoute = route;
  }
  return total;
}

/** 鎖定全優先組合的最快一輪秒數；無圖模式時回傳 null */
export function resolveLockedRotationMinSeconds(
  policy: RouteSuccessorPolicy,
): number | null {
  if (policy.algorithm !== ROUTE_SUCCESSOR_ALGORITHM_GRAPH) return null;
  const canonical = pickCanonicalCycle(policy.throughCycles);
  return canonical?.minCycleSeconds ?? null;
}

export function routeAssignmentAlgorithmId(
  policy: RouteSuccessorPolicy,
): string {
  if (!policy.valid) return 'route-assignment-invalid-relation-graph-v1';
  return policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
    ? 'route-assignment-relation-graph-v1'
    : 'constraint-greedy-v1';
}

export function rotationCompletionAlgorithmId(
  policy: RouteSuccessorPolicy,
): string {
  if (!policy.valid) return 'rotation-cycle-invalid-relation-graph-v1';
  return policy.algorithm === ROUTE_SUCCESSOR_ALGORITHM_GRAPH
    ? 'rotation-cycle-through-anchors-v1'
    : 'rotation-cycle-completion-v1';
}
