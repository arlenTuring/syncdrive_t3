/**
 * 路線繼任策略：把 Step 4 關聯圖 + 折返錨點轉成排班引擎可用的繼任規則。
 *
 * - `relation-graph-through-anchors-v1`：班際繼任**只允許關聯圖上的短邊**（拓樸拆解後的唯一可能）；
 *   「優先採用」導通組合只用於開輪相位／同分偏好，不得發明 TN→NTB 這類圖上不存在的繞回。
 * 沒有關聯圖（或沒有已驗證的路線組合）就是無效策略，不生成；2026-09-30 起不再依路線排列順序
 * 自動輪替（白皮書 ROUTE-02：正線接續只依關聯圖）。
 */

import type { ShiftScheduleSelectedRoute } from '../../types/create';
import { resolveSelectedRouteInstanceId } from '../../types/create';
import {
  emptyShiftRouteRelationGraph,
  isRouteRelationJunctionMatched,
  resolveRouteOriginStation,
  resolveRouteRelationNextKind,
  resolveRouteTerminalStation,
  type ShiftRouteRelationGraph,
} from '../routeRelationGraph';
import {
  computeRouteThroughPaths,
  emptyShiftRouteThroughAnchorsDraft,
  isThroughVerificationCurrent,
  resolvePreferredThroughCycle,
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
export const ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH =
  'invalid-relation-graph-v1' as const;

export type RouteSuccessorAlgorithm =
  | typeof ROUTE_SUCCESSOR_ALGORITHM_GRAPH
  | typeof ROUTE_SUCCESSOR_ALGORITHM_INVALID_GRAPH;

export type RouteSuccessorPolicyIssue =
  /** 路線群組沒有畫關聯圖（或只有一條路線卻沒有檢查過路線組合） */
  | 'RELATION_GRAPH_MISSING'
  | 'THROUGH_VERIFICATION_INVALID'
  | 'NO_PRIORITY_THROUGH_PATH'
  | 'THROUGH_PATH_ROUTE_MISSING';

export type RouteSuccessorPolicy = {
  algorithm: RouteSuccessorAlgorithm;
  /** 有圖但無法建立可信 successor 時為 false；呼叫端必須當 fatal issue 處理。 */
  valid: boolean;
  issue?: RouteSuccessorPolicyIssue;
  routesByInstanceId: Map<string, ShiftScheduleSelectedRoute>;
  /**
   * 偏好輪替列表（graph＝優先採用導通；ring＝executionOrder）。
   * 僅供開輪相位／估週期；不得當成無邊時的發明繼任。
   */
  rotationRoutes: ShiftScheduleSelectedRoute[];
  /** 關聯圖優先短邊：from → to[]（已依偏好排序） */
  prioritySuccessors: Map<string, string[]>;
  /** 關聯圖次要短邊 */
  secondarySuccessors: Map<string, string[]>;
  startInstanceIds: string[];
  endInstanceIds: Set<string>;
  canonicalCycleInstanceIds: string[];
  throughCycles: RouteThroughCycle[];
};

function occupancySeconds(route: ShiftScheduleSelectedRoute): number {
  return resolvePassengerRouteOccupancy(route)?.occupancySeconds ?? 0;
}

function pickCanonicalCycle(
  cycles: RouteThroughCycle[],
  preferredThroughCycleId?: string | null,
): RouteThroughCycle | null {
  return resolvePreferredThroughCycle(cycles, preferredThroughCycleId);
}

/** 同層多出口時：偏好路徑上下一跳優先；圖上無該邊則不強加 */
function orderSuccessorsByPreferred(
  fromInstanceId: string,
  tos: string[],
  preferredIds: readonly string[],
): string[] {
  if (tos.length <= 1) return [...tos];
  const idx = preferredIds.indexOf(fromInstanceId);
  const preferredNext =
    idx >= 0 && idx < preferredIds.length - 1 ? preferredIds[idx + 1]! : null;
  const preferredWrap =
    idx === preferredIds.length - 1 && preferredIds.length > 1
      ? preferredIds[0]!
      : null;
  return [...tos].sort((a, b) => {
    const rank = (id: string) => {
      if (preferredNext && id === preferredNext) return 0;
      if (preferredWrap && id === preferredWrap) return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/**
 * 由關聯圖短邊建出繼任表（僅 junction 吻合的邊）。
 * 這是排班唯一合法班際可能；優先採用只影響同層排序。
 */
function buildSuccessorsFromRelationGraph(
  graph: ShiftRouteRelationGraph,
  routesByInstanceId: Map<string, ShiftScheduleSelectedRoute>,
  preferredIds: readonly string[],
): {
  prioritySuccessors: Map<string, string[]>;
  secondarySuccessors: Map<string, string[]>;
} {
  const prioritySuccessors = new Map<string, string[]>();
  const secondarySuccessors = new Map<string, string[]>();

  for (const link of graph.links) {
    const from = routesByInstanceId.get(link.fromInstanceId);
    const to = routesByInstanceId.get(link.toInstanceId);
    if (!from || !to) continue;
    if (!isRouteRelationJunctionMatched(from, to)) continue;
    const kind = resolveRouteRelationNextKind(link);
    const bucket =
      kind === 'secondary' ? secondarySuccessors : prioritySuccessors;
    const list = bucket.get(link.fromInstanceId) ?? [];
    if (!list.includes(link.toInstanceId)) {
      list.push(link.toInstanceId);
      bucket.set(link.fromInstanceId, list);
    }
  }

  for (const [from, tos] of prioritySuccessors) {
    prioritySuccessors.set(from, orderSuccessorsByPreferred(from, tos, preferredIds));
  }
  for (const [from, tos] of secondarySuccessors) {
    secondarySuccessors.set(from, orderSuccessorsByPreferred(from, tos, preferredIds));
  }

  return { prioritySuccessors, secondarySuccessors };
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
  const graph = input.graph ?? emptyShiftRouteRelationGraph();
  if (routes.length === 0) {
    return buildInvalidGraphPolicy(
      routes,
      graph.links.length > 0 ? 'THROUGH_VERIFICATION_INVALID' : 'RELATION_GRAPH_MISSING',
    );
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
  // 沒畫關聯圖、也沒有檢查過路線組合：不能自己依排列順序輪替（ROUTE-02）。
  // 只有一條路線時，關聯圖可以沒有連線，但仍要在路線群組指定起算／結算並檢查過。
  if (graph.links.length === 0 && !verified) {
    return buildInvalidGraphPolicy(routes, 'RELATION_GRAPH_MISSING');
  }
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
  const canonical = pickCanonicalCycle(
    throughCycles,
    anchors.preferredThroughCycleId,
  );
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

  const { prioritySuccessors, secondarySuccessors } = buildSuccessorsFromRelationGraph(
    graph,
    routesByInstanceId,
    canonical.instanceIds,
  );

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
  // 開輪偏好：同出場站若多線可掛，偏好列在「優先採用」上越前的越好搶插；
  // 不得用偏好路徑冒充圖邊（例如 TN 終點硬接 NTB）。
  const preferredFirstStarts = [
    ...canonical.instanceIds.filter((id) => startInstanceIds.includes(id)),
    ...startInstanceIds.filter((id) => !canonical.instanceIds.includes(id)),
  ];
  const canonicalFirstStarts =
    preferredFirstStarts.length > 0
      ? preferredFirstStarts
      : [
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
    secondarySuccessors,
    startInstanceIds: canonicalFirstStarts,
    endInstanceIds,
    canonicalCycleInstanceIds: [...canonical.instanceIds],
    throughCycles,
  };
}

/**
 * 開輪時「合法的起始 instance」全部列出來，最偏好的排最前面。
 *
 * <strong>為什麼要 list，而不是只回一條。</strong>Step 4 的折返錨點
 * （<code>throughAnchors.startInstanceIds</code>）表達的是使用者<strong>偏好</strong>
 * 從哪一條起算，不是物理限制——真正的物理限制是整備出場站，那由
 * <code>exitStationId</code> 這條分支管，而且它<strong>完全不看錨點</strong>：
 * 只要起點站對得上就收。
 *
 * 沒有出場站時（真正的冷啟動，前面沒有任何整備把車位置釘死），車停哪裡是
 * <strong>這個選擇造成的結果</strong>，不是既成事實。此時把錨點當成唯一解，等於
 * 讓使用者在 Step 4 隨手點的一條，決定了整天第一班從哪一格發車——站位求解器
 * 之後想換也換不掉，只能靠延後發車去閃，代價全落在班距上。
 *
 * 所以：偏好順序照舊（錨點 → 導通組合順序），但把其餘導通組合成員也列為
 * 合法候選，讓下游有站位資訊的那一段（見 stationBerthConstraint 的冷啟動分支）
 * 有東西可挑。<strong>只加候選、不改第一名</strong>，故 {@link resolveStartInstanceId}
 * 的結果與此變更前完全相同。
 */
export function resolveStartInstanceCandidates(
  policy: RouteSuccessorPolicy,
  exitStationId?: string | null,
): string[] {
  if (!policy.valid) return [];
  const exit = exitStationId?.trim() || '';
  if (exit) {
    const matches: Array<{ instanceId: string; preferredIndex: number }> = [];
    for (const [instanceId, route] of policy.routesByInstanceId) {
      const origin = resolveRouteOriginStation(route)?.stationId;
      if (origin !== exit) continue;
      const preferredIndex = policy.canonicalCycleInstanceIds.indexOf(instanceId);
      matches.push({
        instanceId,
        preferredIndex: preferredIndex >= 0 ? preferredIndex : Number.MAX_SAFE_INTEGER,
      });
    }
    if (matches.length > 0) {
      matches.sort((a, b) => {
        if (a.preferredIndex !== b.preferredIndex) {
          return a.preferredIndex - b.preferredIndex;
        }
        return a.instanceId.localeCompare(b.instanceId);
      });
      return matches.map((item) => item.instanceId);
    }
  }

  const ordered: string[] = [];
  const push = (instanceId: string | null | undefined) => {
    if (!instanceId) return;
    if (ordered.includes(instanceId)) return;
    if (!policy.routesByInstanceId.has(instanceId)) return;
    ordered.push(instanceId);
  };
  // 1. 使用者錨點（第一名不變）
  for (const instanceId of policy.startInstanceIds) push(instanceId);
  // 2. 沒錨點時的原兜底：輪替第一條
  if (ordered.length === 0 && policy.rotationRoutes[0]) {
    push(resolveSelectedRouteInstanceId(policy.rotationRoutes[0]));
  }
  // 3. 其餘導通組合成員——放寬後才看得到的候選
  for (const instanceId of policy.canonicalCycleInstanceIds) push(instanceId);
  return ordered;
}

/**
 * 出場站／開輪時挑選起始 instance。
 * 同站多線時：優先採用路徑上越前面的越好（利於插班後續沿偏好走），仍必須是該站起點。
 */
export function resolveStartInstanceId(
  policy: RouteSuccessorPolicy,
  exitStationId?: string | null,
): string | null {
  return resolveStartInstanceCandidates(policy, exitStationId)[0] ?? null;
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
 * 由目前路線決定下一程：只走關聯圖短邊。
 * 優先採用路徑的下一跳若在圖上存在（優先或次要邊），先取它；否則取其他優先邊；
 * `allowSecondary` 時才取其餘次要。
 * ring 模式等同執行順序下一條。
 * 绝不以「折返錨點→偏好起點」發明不存在的邊。
 */
export function resolveNextInstanceId(
  policy: RouteSuccessorPolicy,
  currentInstanceId: string,
  options?: { allowSecondary?: boolean },
): { instanceId: string; kind: 'priority' | 'secondary' | 'ring' } | null {
  if (!policy.valid) return null;
  const allowSecondary = options?.allowSecondary === true;

  const preferredIds = policy.canonicalCycleInstanceIds;
  const preferredIndex = preferredIds.indexOf(currentInstanceId);
  const preferredNext =
    preferredIndex >= 0 && preferredIndex < preferredIds.length - 1
      ? preferredIds[preferredIndex + 1]!
      : null;
  const preferredWrap =
    preferredIndex === preferredIds.length - 1 && preferredIds.length > 1
      ? preferredIds[0]!
      : null;

  const priority = policy.prioritySuccessors.get(currentInstanceId) ?? [];
  const secondary = policy.secondarySuccessors.get(currentInstanceId) ?? [];

  if (preferredNext && priority.includes(preferredNext)) {
    return { instanceId: preferredNext, kind: 'priority' };
  }
  if (preferredNext && secondary.includes(preferredNext)) {
    return { instanceId: preferredNext, kind: 'secondary' };
  }
  if (priority.length > 0) {
    return { instanceId: priority[0]!, kind: 'priority' };
  }
  if (allowSecondary && secondary.length > 0) {
    return { instanceId: secondary[0]!, kind: 'secondary' };
  }
  // 偏好繞回也必須是真實邊
  if (preferredWrap && priority.includes(preferredWrap)) {
    return { instanceId: preferredWrap, kind: 'priority' };
  }
  if (preferredWrap && secondary.includes(preferredWrap) && allowSecondary) {
    return { instanceId: preferredWrap, kind: 'secondary' };
  }

  return null;
}

/** 列出可嘗試的下一程（偏好下一跳在前，其餘優先邊，再次要）— 僅關聯圖邊 */
export function listNextInstanceCandidates(
  policy: RouteSuccessorPolicy,
  currentInstanceId: string,
  options?: { allowSecondary?: boolean },
): Array<{ instanceId: string; kind: 'priority' | 'secondary' | 'ring' }> {
  const allowSecondary = options?.allowSecondary === true;
  const primary = resolveNextInstanceId(policy, currentInstanceId, {
    allowSecondary,
  });
  const out: Array<{ instanceId: string; kind: 'priority' | 'secondary' | 'ring' }> =
    [];
  if (primary) out.push(primary);
  for (const id of policy.prioritySuccessors.get(currentInstanceId) ?? []) {
    if (!out.some((item) => item.instanceId === id)) {
      out.push({ instanceId: id, kind: 'priority' });
    }
  }
  if (allowSecondary) {
    for (const id of policy.secondarySuccessors.get(currentInstanceId) ?? []) {
      if (!out.some((item) => item.instanceId === id)) {
        out.push({ instanceId: id, kind: 'secondary' });
      }
    }
  }
  return out;
}

export function isCycleClosingInstance(
  policy: RouteSuccessorPolicy,
  instanceId: string,
): boolean {
  if (!policy.valid) return false;
  return policy.endInstanceIds.has(instanceId);
}

/**
 * 自 start 沿著關聯圖合法下一跳估一輪剩餘（最多 preference 長度）；
 * 無出邊則提早停。
 */
export function estimatePolicyCycleSeconds(
  policy: RouteSuccessorPolicy,
  startInstanceId: string,
  minimumRecoveryTimeSeconds: number,
): number {
  const routes = policy.rotationRoutes;
  if (routes.length === 0) return 0;

  const maxHops = Math.max(1, policy.canonicalCycleInstanceIds.length);
  let total = 0;
  let prevRoute: ShiftScheduleSelectedRoute | null = null;
  let currentId = startInstanceId;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const route = policy.routesByInstanceId.get(currentId);
    if (!route) break;
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
    const next =
      resolveNextInstanceId(policy, currentId)
      ?? resolveNextInstanceId(policy, currentId, { allowSecondary: true });
    if (!next) break;
    currentId = next.instanceId;
  }
  return total;
}

/** 鎖定「優先採用」組合的一輪秒數；無圖模式時回傳 null */
export function resolveLockedRotationMinSeconds(
  policy: RouteSuccessorPolicy,
): number | null {
  if (policy.algorithm !== ROUTE_SUCCESSOR_ALGORITHM_GRAPH) return null;
  const ids = policy.canonicalCycleInstanceIds;
  const matched = policy.throughCycles.find(
    (cycle) =>
      cycle.instanceIds.length === ids.length
      && cycle.instanceIds.every((id, index) => id === ids[index]),
  );
  return matched?.minCycleSeconds ?? null;
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
