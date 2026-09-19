/**
 * 導通驗算：使用者指定起點／終點站（可複數），
 * 沿關聯圖找「起站 ∈ 起點、終站 ∈ 終點」的最短路徑組合。
 */

import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  applyStationDwellWithSlack,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSwitchBufferAfterSeconds,
  resolveSelectedRouteInstanceId,
} from '../types/create';
import {
  isRouteRelationJunctionMatched,
  resolveRouteOriginStation,
  resolveRouteRelationNextKind,
  resolveRouteTerminalStation,
  type ShiftRouteRelationGraph,
  type ShiftRouteRelationNextKind,
} from './routeRelationGraph';

export type ThroughStationOption = {
  stationId: string;
  stationName: string;
  /** 下拉分組鍵 */
  groupKey: string;
  /** 下拉分組顯示名 */
  groupLabel: string;
};

export type ThroughStationOptionGroup = {
  label: string;
  options: Array<{ value: string; label: string }>;
};

const GROUP_ORDER = [
  'docking-up',
  'docking-down',
  'backup-up',
  'backup-down',
  'facility-docking',
  'other',
] as const;

function classifyThroughStation(
  stationId: string,
  stationName: string,
): { groupKey: string; groupLabel: string } {
  const id = stationId.trim();
  const name = stationName.trim();
  if (id.startsWith('fdock:')) {
    return { groupKey: 'facility-docking', groupLabel: '設施停靠點' };
  }
  const isBackup = /\[備用\]|^備用/.test(name);
  const isUp = name.includes('上行');
  const isDown = name.includes('下行');
  if (isBackup && isUp) return { groupKey: 'backup-up', groupLabel: '備用 · 上行' };
  if (isBackup && isDown) return { groupKey: 'backup-down', groupLabel: '備用 · 下行' };
  if (isUp) return { groupKey: 'docking-up', groupLabel: '停靠點 · 上行' };
  if (isDown) return { groupKey: 'docking-down', groupLabel: '停靠點 · 下行' };
  return { groupKey: 'other', groupLabel: '其他站點' };
}

/** 從已選路線收集可當起／迄的站點（停靠點／設施停靠點皆可） */
export function collectThroughStationOptions(
  routes: ShiftScheduleSelectedRoute[],
): ThroughStationOption[] {
  const byId = new Map<string, string>();
  for (const route of routes) {
    for (const dwell of route.stationDwells) {
      const id = dwell.stationId?.trim();
      if (!id) continue;
      const name = dwell.stationName?.trim() || id;
      if (!byId.has(id)) byId.set(id, name);
    }
    for (const stationId of route.stationIds) {
      const id = stationId?.trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, id);
    }
  }
  return [...byId.entries()]
    .map(([stationId, stationName]) => {
      const classified = classifyThroughStation(stationId, stationName);
      return {
        stationId,
        stationName,
        groupKey: classified.groupKey,
        groupLabel: classified.groupLabel,
      };
    })
    .sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a.groupKey as (typeof GROUP_ORDER)[number]);
      const bi = GROUP_ORDER.indexOf(b.groupKey as (typeof GROUP_ORDER)[number]);
      const aOrder = ai < 0 ? GROUP_ORDER.length : ai;
      const bOrder = bi < 0 ? GROUP_ORDER.length : bi;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.stationName.localeCompare(b.stationName, 'zh-Hant');
    });
}

/** 轉成 ShiftMenuSelect 用的分組選項（已排除 excludeIds） */
export function buildThroughStationMenuGroups(
  options: ThroughStationOption[],
  excludeIds: ReadonlySet<string> | readonly string[] = [],
): ThroughStationOptionGroup[] {
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
  const buckets = new Map<string, ThroughStationOptionGroup>();
  for (const option of options) {
    if (excluded.has(option.stationId)) continue;
    let group = buckets.get(option.groupKey);
    if (!group) {
      group = { label: option.groupLabel, options: [] };
      buckets.set(option.groupKey, group);
    }
    group.options.push({
      value: option.stationId,
      label: option.stationName,
    });
  }
  return GROUP_ORDER.map((key) => buckets.get(key)).filter(
    (group): group is ThroughStationOptionGroup =>
      Boolean(group && group.options.length > 0),
  );
}

export type RouteThroughCycle = {
  id: string;
  instanceIds: string[];
  labels: string[];
  startStationId: string;
  startStationName: string;
  endStationId: string;
  endStationName: string;
  hopCount: number;
  secondaryCount: number;
  linkKinds: ShiftRouteRelationNextKind[];
  minTravelSeconds: number;
  avgTravelSeconds: number;
  dwellSeconds: number;
  switchBufferSeconds: number;
  recoverySeconds: number;
  minCycleSeconds: number;
  avgCycleSeconds: number;
};

type AdjEdge = {
  toInstanceId: string;
  kind: ShiftRouteRelationNextKind;
};

function routeLabel(route: ShiftScheduleSelectedRoute): string {
  const code = route.routeCode?.trim();
  if (code) return code;
  const name = route.routeName?.trim();
  if (name) return name;
  return resolveSelectedRouteInstanceId(route);
}

function sumRouteDwells(route: ShiftScheduleSelectedRoute): number {
  return route.stationDwells.reduce(
    (sum, dwell, index) =>
      sum + applyStationDwellWithSlack(dwell, route.dwellSlackSeconds, index),
    0,
  );
}

function buildAdj(
  graph: ShiftRouteRelationGraph,
  routeById: Map<string, ShiftScheduleSelectedRoute>,
): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  for (const link of graph.links) {
    const from = routeById.get(link.fromInstanceId);
    const to = routeById.get(link.toInstanceId);
    if (!from || !to) continue;
    if (!isRouteRelationJunctionMatched(from, to)) continue;
    const list = adj.get(link.fromInstanceId) ?? [];
    list.push({
      toInstanceId: link.toInstanceId,
      kind: resolveRouteRelationNextKind(link),
    });
    adj.set(link.fromInstanceId, list);
  }
  return adj;
}

function buildCycle(args: {
  pathIds: string[];
  linkKinds: ShiftRouteRelationNextKind[];
  routeById: Map<string, ShiftScheduleSelectedRoute>;
  recoverySeconds: number;
  stationNameById: Map<string, string>;
}): RouteThroughCycle | null {
  const { pathIds, linkKinds, routeById, recoverySeconds, stationNameById } = args;
  const pathRoutes = pathIds
    .map((id) => routeById.get(id))
    .filter((route): route is ShiftScheduleSelectedRoute => Boolean(route));
  if (pathRoutes.length !== pathIds.length || pathRoutes.length === 0) return null;

  const first = pathRoutes[0]!;
  const last = pathRoutes[pathRoutes.length - 1]!;
  const origin = resolveRouteOriginStation(first);
  const terminal = resolveRouteTerminalStation(last);
  if (!origin || !terminal) return null;

  let minTravel = 0;
  let avgTravel = 0;
  let dwellSeconds = 0;
  let switchBufferSeconds = 0;

  for (let i = 0; i < pathRoutes.length; i += 1) {
    const route = pathRoutes[i]!;
    const minT = route.minTravelTimeSeconds;
    const avgT = route.avgTravelTimeSeconds;
    if (minT == null || minT <= 0 || avgT == null || avgT <= 0) return null;
    minTravel += minT;
    avgTravel += avgT;
    dwellSeconds += sumRouteDwells(route);
    if (i < pathRoutes.length - 1) {
      switchBufferSeconds += normalizeSwitchBufferAfterSeconds(
        route.switchBufferAfterSeconds,
      );
    }
  }

  const secondaryCount = linkKinds.filter((kind) => kind === 'secondary').length;
  return {
    id: `${origin.stationId}>${pathIds.join('>')}>${terminal.stationId}`,
    instanceIds: pathIds,
    labels: pathRoutes.map(routeLabel),
    startStationId: origin.stationId,
    startStationName: stationNameById.get(origin.stationId) ?? origin.stationName,
    endStationId: terminal.stationId,
    endStationName: stationNameById.get(terminal.stationId) ?? terminal.stationName,
    hopCount: pathIds.length,
    secondaryCount,
    linkKinds,
    minTravelSeconds: Math.round(minTravel),
    avgTravelSeconds: Math.round(avgTravel),
    dwellSeconds: Math.round(dwellSeconds),
    switchBufferSeconds: Math.round(switchBufferSeconds),
    recoverySeconds,
    minCycleSeconds: Math.round(
      minTravel + dwellSeconds + switchBufferSeconds + recoverySeconds,
    ),
    avgCycleSeconds: Math.round(
      avgTravel + dwellSeconds + switchBufferSeconds + recoverySeconds,
    ),
  };
}

/**
 * 路線組合驗算：
 * - 路線模式：種子＝起算 instance；走到結算 instance 時收錄並停止延伸
 * - 站點模式（舊稿）：起站命中為種子；終站命中為結束
 * - 每個種子只保留最少 hop 的路徑
 */
export function computeRouteThroughPaths(args: {
  startStationIds?: string[];
  endStationIds?: string[];
  startInstanceIds?: string[];
  endInstanceIds?: string[];
  routes: ShiftScheduleSelectedRoute[];
  graph: ShiftRouteRelationGraph;
  minimumRecoveryTimeSeconds?: number | null;
}): RouteThroughCycle[] {
  const startInstanceIds = new Set(
    (args.startInstanceIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const endInstanceIds = new Set(
    (args.endInstanceIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const useRouteMode = startInstanceIds.size > 0 && endInstanceIds.size > 0;

  const startIds = new Set(
    (args.startStationIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const endIds = new Set(
    (args.endStationIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  if (useRouteMode) {
    // ok
  } else if (startIds.size === 0 || endIds.size === 0) {
    return [];
  }

  const recoverySeconds = normalizeMinimumRecoveryTimeSeconds(
    args.minimumRecoveryTimeSeconds ?? 0,
  );
  const routeById = new Map(
    args.routes.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
  );
  const stationNameById = new Map(
    collectThroughStationOptions(args.routes).map((item) => [
      item.stationId,
      item.stationName,
    ]),
  );
  const adj = buildAdj(args.graph, routeById);

  const seeds = useRouteMode
    ? args.routes.filter((route) =>
        startInstanceIds.has(resolveSelectedRouteInstanceId(route)),
      )
    : args.routes.filter((route) => {
        const origin = resolveRouteOriginStation(route);
        return Boolean(origin && startIds.has(origin.stationId));
      });

  const found: RouteThroughCycle[] = [];

  for (const seed of seeds) {
    const seedId = resolveSelectedRouteInstanceId(seed);
    type QueueItem = {
      pathIds: string[];
      linkKinds: ShiftRouteRelationNextKind[];
    };
    const queue: QueueItem[] = [{ pathIds: [seedId], linkKinds: [] }];
    let minHops = Number.POSITIVE_INFINITY;
    const seedResults: RouteThroughCycle[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const hops = current.pathIds.length;
      if (hops > minHops) continue;

      const currentId = current.pathIds[current.pathIds.length - 1]!;
      const currentRoute = routeById.get(currentId);
      if (!currentRoute) continue;

      const reachedEnd = useRouteMode
        ? endInstanceIds.has(currentId)
        : (() => {
            const terminal = resolveRouteTerminalStation(currentRoute);
            return Boolean(terminal && endIds.has(terminal.stationId));
          })();

      if (reachedEnd) {
        if (hops < minHops) {
          minHops = hops;
          seedResults.length = 0;
        }
        if (hops === minHops) {
          const cycle = buildCycle({
            pathIds: current.pathIds,
            linkKinds: current.linkKinds,
            routeById,
            recoverySeconds,
            stationNameById,
          });
          if (cycle) seedResults.push(cycle);
        }
        continue;
      }

      const edges = adj.get(currentId) ?? [];
      const used = new Set(current.pathIds);
      for (const edge of edges) {
        if (used.has(edge.toInstanceId)) continue;
        queue.push({
          pathIds: [...current.pathIds, edge.toInstanceId],
          linkKinds: [...current.linkKinds, edge.kind],
        });
      }
    }

    found.push(...seedResults);
  }

  const unique = new Map<string, RouteThroughCycle>();
  for (const item of found) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }

  const list = [...unique.values()];
  list.sort((a, b) => {
    const aAllPriority = a.secondaryCount === 0 ? 1 : 0;
    const bAllPriority = b.secondaryCount === 0 ? 1 : 0;
    if (aAllPriority !== bAllPriority) return aAllPriority - bAllPriority;
    if (a.secondaryCount !== b.secondaryCount) {
      return a.secondaryCount - b.secondaryCount;
    }
    if (a.hopCount !== b.hopCount) return a.hopCount - b.hopCount;
    if (a.minCycleSeconds !== b.minCycleSeconds) {
      return a.minCycleSeconds - b.minCycleSeconds;
    }
    return a.id.localeCompare(b.id);
  });

  return list;
}

export type ShiftRouteThroughAnchorsDraft = {
  /**
   * @deprecated 改以路線 instance 起算／結算；保留供舊草稿相容。
   */
  startStationIds: string[];
  /**
   * @deprecated 改以路線 instance 起算／結算；保留供舊草稿相容。
   */
  endStationIds: string[];
  /** 由此起算的路線 instanceId（可複數） */
  startInstanceIds: string[];
  /** 到此結算的路線 instanceId（可複數） */
  endInstanceIds: string[];
  /**
   * 最近一次「檢查路線組合」通過時的輸入指紋。
   * 與目前指紋一致才算仍有效；改關聯／起迄／路線參數會自動失效。
   */
  verifiedFingerprint: string | null;
  /** 通過時找到的最短路徑數 */
  verifiedPathCount: number;
  /**
   * 使用者指定「優先採用」的導通組合 id（RouteThroughCycle.id）。
   * Step 4 必須點選後才能下一步；排班以此為開輪偏好。
   */
  preferredThroughCycleId: string | null;
  /**
   * 最近一次「檢查路線組合」算出的清單（持久保存；回 Step 4 仍顯示）。
   * 僅在使用者再按檢查時覆寫。
   */
  listedThroughCycles: RouteThroughCycle[];
  /** 算出 listedThroughCycles 當下的輸入指紋（用來判斷清單是否過時） */
  listedFingerprint: string | null;
};

/**
 * 路線換掉之後，起算／結算與上一次的驗算結果一律失效。
 *
 * 起算／結算存的是 instanceId，而換圖之後同一個 instanceId 可能是另一條路線；
 * 驗算結果更是照舊的關聯算出來的。留著只會讓 Step 4 以「已通過」的狀態帶著錯的組合
 * 往下走，所以只要有路線變動就整份清掉，讓使用者重新指定。
 */
export function invalidateThroughAnchorsForRouteChange(
  anchors: ShiftRouteThroughAnchorsDraft,
  changedInstanceIds: ReadonlySet<string>,
): { anchors: ShiftRouteThroughAnchorsDraft; changed: boolean } {
  const keep = (ids: string[]) => ids.filter((id) => !changedInstanceIds.has(id));
  const nextStart = keep(anchors.startInstanceIds);
  const nextEnd = keep(anchors.endInstanceIds);
  const anchorsDropped =
    nextStart.length !== anchors.startInstanceIds.length
    || nextEnd.length !== anchors.endInstanceIds.length;
  const hadVerification =
    anchors.verifiedFingerprint !== null
    || anchors.preferredThroughCycleId !== null
    || anchors.listedThroughCycles.length > 0;
  if (changedInstanceIds.size === 0) return { anchors, changed: false };
  if (!anchorsDropped && !hadVerification) return { anchors, changed: false };
  return {
    anchors: {
      ...anchors,
      startInstanceIds: nextStart,
      endInstanceIds: nextEnd,
      verifiedFingerprint: null,
      verifiedPathCount: 0,
      preferredThroughCycleId: null,
      listedThroughCycles: [],
      listedFingerprint: null,
    },
    changed: true,
  };
}

export function emptyShiftRouteThroughAnchorsDraft(): ShiftRouteThroughAnchorsDraft {
  return {
    startStationIds: [],
    endStationIds: [],
    startInstanceIds: [],
    endInstanceIds: [],
    verifiedFingerprint: null,
    verifiedPathCount: 0,
    preferredThroughCycleId: null,
    listedThroughCycles: [],
    listedFingerprint: null,
  };
}

/** 全優先在前、次要在後；同層再依最快秒數 */
export function sortListedThroughCycles(
  cycles: RouteThroughCycle[],
): RouteThroughCycle[] {
  return [...cycles].sort((a, b) => {
    if (a.secondaryCount === 0 && b.secondaryCount > 0) return -1;
    if (a.secondaryCount > 0 && b.secondaryCount === 0) return 1;
    if (a.minCycleSeconds !== b.minCycleSeconds) {
      return a.minCycleSeconds - b.minCycleSeconds;
    }
    return a.id.localeCompare(b.id);
  });
}

/** 解析優先採用組合；無效偏好時回退全優先最快（再退整體最快） */
export function resolvePreferredThroughCycle(
  cycles: RouteThroughCycle[],
  preferredThroughCycleId?: string | null,
): RouteThroughCycle | null {
  if (cycles.length === 0) return null;
  const preferredId = preferredThroughCycleId?.trim() || '';
  if (preferredId) {
    const hit = cycles.find((item) => item.id === preferredId);
    if (hit) return hit;
  }
  const priorityOnly = cycles.filter((item) => item.secondaryCount === 0);
  const pool = priorityOnly.length > 0 ? priorityOnly : cycles;
  return sortListedThroughCycles(pool)[0] ?? null;
}

function parseRouteThroughCycle(raw: unknown): RouteThroughCycle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id) return null;
  const instanceIds = Array.isArray(o.instanceIds)
    ? o.instanceIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  if (instanceIds.length === 0) return null;
  const labels = Array.isArray(o.labels)
    ? o.labels.map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    : instanceIds;
  const linkKinds = Array.isArray(o.linkKinds)
    ? o.linkKinds.map((item) => (item === 'secondary' ? 'secondary' as const : 'priority' as const))
    : [];
  const num = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    id,
    instanceIds,
    labels,
    startStationId: typeof o.startStationId === 'string' ? o.startStationId : '',
    startStationName: typeof o.startStationName === 'string' ? o.startStationName : '',
    endStationId: typeof o.endStationId === 'string' ? o.endStationId : '',
    endStationName: typeof o.endStationName === 'string' ? o.endStationName : '',
    hopCount: Math.max(1, Math.round(num(o.hopCount, instanceIds.length))),
    secondaryCount: Math.max(0, Math.round(num(o.secondaryCount, 0))),
    linkKinds,
    minTravelSeconds: Math.round(num(o.minTravelSeconds)),
    avgTravelSeconds: Math.round(num(o.avgTravelSeconds)),
    dwellSeconds: Math.round(num(o.dwellSeconds)),
    switchBufferSeconds: Math.round(num(o.switchBufferSeconds)),
    recoverySeconds: Math.round(num(o.recoverySeconds)),
    minCycleSeconds: Math.round(num(o.minCycleSeconds)),
    avgCycleSeconds: Math.round(num(o.avgCycleSeconds)),
  };
}

export function parseShiftRouteThroughAnchorsDraft(
  raw: unknown,
): ShiftRouteThroughAnchorsDraft {
  if (!raw || typeof raw !== 'object') return emptyShiftRouteThroughAnchorsDraft();
  const o = raw as Record<string, unknown>;
  const startStationIds = Array.isArray(o.startStationIds)
    ? o.startStationIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const endStationIds = Array.isArray(o.endStationIds)
    ? o.endStationIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const startInstanceIds = Array.isArray(o.startInstanceIds)
    ? o.startInstanceIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const endInstanceIds = Array.isArray(o.endInstanceIds)
    ? o.endInstanceIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const verifiedFingerprint =
    typeof o.verifiedFingerprint === 'string' && o.verifiedFingerprint.trim()
      ? o.verifiedFingerprint.trim()
      : null;
  const verifiedPathCount =
    typeof o.verifiedPathCount === 'number' && Number.isFinite(o.verifiedPathCount)
      ? Math.max(0, Math.round(o.verifiedPathCount))
      : 0;
  const preferredThroughCycleId =
    typeof o.preferredThroughCycleId === 'string' && o.preferredThroughCycleId.trim()
      ? o.preferredThroughCycleId.trim()
      : null;
  const listedThroughCycles = Array.isArray(o.listedThroughCycles)
    ? sortListedThroughCycles(
        o.listedThroughCycles
          .map((item) => parseRouteThroughCycle(item))
          .filter((item): item is RouteThroughCycle => item != null),
      )
    : [];
  const listedFingerprint =
    typeof o.listedFingerprint === 'string' && o.listedFingerprint.trim()
      ? o.listedFingerprint.trim()
      : null;
  return {
    startStationIds: [...new Set(startStationIds)],
    endStationIds: [...new Set(endStationIds)],
    startInstanceIds: [...new Set(startInstanceIds)],
    endInstanceIds: [...new Set(endInstanceIds)],
    verifiedFingerprint,
    verifiedPathCount,
    preferredThroughCycleId,
    listedThroughCycles,
    listedFingerprint,
  };
}

/** 路線組合檢查指紋（起算／結算路線＋關聯圖＋行駛參數） */
export function buildThroughVerificationFingerprint(input: {
  startStationIds?: string[];
  endStationIds?: string[];
  startInstanceIds?: string[];
  endInstanceIds?: string[];
  routes: ShiftScheduleSelectedRoute[];
  graph: ShiftRouteRelationGraph;
  minimumRecoveryTimeSeconds?: number | null;
  /** @deprecated 折返時限改在 isThroughVerificationCurrent 另行檢查，不進指紋 */
  turnaroundLimitSeconds?: number | null;
}): string {
  const startInstances = [
    ...(input.startInstanceIds ?? []),
  ]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();
  const endInstances = [...(input.endInstanceIds ?? [])]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();
  const starts = [...(input.startStationIds ?? [])].map((id) => id.trim()).filter(Boolean).sort();
  const ends = [...(input.endStationIds ?? [])].map((id) => id.trim()).filter(Boolean).sort();
  const routes = input.routes.map((route) => ({
    instanceId: resolveSelectedRouteInstanceId(route),
    routeId: route.routeId,
    origin: resolveRouteOriginStation(route)?.stationId ?? null,
    terminal: resolveRouteTerminalStation(route)?.stationId ?? null,
    minTravelTimeSeconds: route.minTravelTimeSeconds,
    avgTravelTimeSeconds: route.avgTravelTimeSeconds,
    switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(
      route.switchBufferAfterSeconds,
    ),
    dwellSlackSeconds: route.dwellSlackSeconds,
  }));
  const links = [...input.graph.links]
    .map((link) => ({
      from: link.fromInstanceId,
      to: link.toInstanceId,
      kind: resolveRouteRelationNextKind(link),
    }))
    .sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));
  return JSON.stringify({
    mode: startInstances.length > 0 || endInstances.length > 0 ? 'route' : 'station',
    startInstances,
    endInstances,
    starts,
    ends,
    recovery: normalizeMinimumRecoveryTimeSeconds(
      input.minimumRecoveryTimeSeconds ?? 0,
    ),
    routes,
    links,
  });
}

export function isThroughVerificationCurrent(input: {
  anchors: ShiftRouteThroughAnchorsDraft | null | undefined;
  routes: ShiftScheduleSelectedRoute[];
  graph: ShiftRouteRelationGraph;
  minimumRecoveryTimeSeconds?: number | null;
  turnaroundLimitSeconds?: number | null;
}): boolean {
  const anchors = input.anchors ?? emptyShiftRouteThroughAnchorsDraft();
  if (!anchors.verifiedFingerprint) return false;
  const useRouteMode =
    anchors.startInstanceIds.length > 0 || anchors.endInstanceIds.length > 0;
  if (useRouteMode) {
    if (anchors.startInstanceIds.length === 0 || anchors.endInstanceIds.length === 0) {
      return false;
    }
  } else if (anchors.startStationIds.length === 0 || anchors.endStationIds.length === 0) {
    return false;
  }
  if (anchors.verifiedPathCount <= 0) return false;
  const useStationsInFingerprint = !useRouteMode;
  const current = buildThroughVerificationFingerprint({
    startStationIds: useStationsInFingerprint ? anchors.startStationIds : [],
    endStationIds: useStationsInFingerprint ? anchors.endStationIds : [],
    startInstanceIds: anchors.startInstanceIds,
    endInstanceIds: anchors.endInstanceIds,
    routes: input.routes,
    graph: input.graph,
    minimumRecoveryTimeSeconds: input.minimumRecoveryTimeSeconds,
    turnaroundLimitSeconds: input.turnaroundLimitSeconds,
  });
  if (current !== anchors.verifiedFingerprint) return false;
  const paths = computeRouteThroughPaths({
    startStationIds: useStationsInFingerprint ? anchors.startStationIds : [],
    endStationIds: useStationsInFingerprint ? anchors.endStationIds : [],
    startInstanceIds: anchors.startInstanceIds,
    endInstanceIds: anchors.endInstanceIds,
    routes: input.routes,
    graph: input.graph,
    minimumRecoveryTimeSeconds: input.minimumRecoveryTimeSeconds,
  });
  const priorityPaths = paths.filter((item) => item.secondaryCount === 0);
  if (priorityPaths.length === 0) return false;
  const limit = input.turnaroundLimitSeconds;
  if (limit != null && limit > 0) {
    const best = [...priorityPaths].sort(
      (a, b) => a.minCycleSeconds - b.minCycleSeconds,
    )[0];
    if (best && best.minCycleSeconds > limit) return false;
  }
  return true;
}
