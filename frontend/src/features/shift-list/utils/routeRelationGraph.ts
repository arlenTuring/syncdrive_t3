/** 路線關聯圖（Step 4）：方格佈局與有向接續連線 */

type RouteLike = {
  instanceId?: string;
  routeId: string;
  stationIds: string[];
  stationDwells: Array<{ stationId: string; stationName: string }>;
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
};

function resolveInstanceId(route: RouteLike): string {
  const id = route.instanceId?.trim();
  return id || route.routeId;
}

/** 路線關聯圖：方格佈局 */
export type ShiftRouteRelationNode = {
  instanceId: string;
  x: number;
  y: number;
};

/** 連線指向的下一條路線角色：優先接續或次要接續 */
export type ShiftRouteRelationNextKind = 'priority' | 'secondary';

/** 有向接續：from 跑完後接 to */
export type ShiftRouteRelationLink = {
  id: string;
  fromInstanceId: string;
  toInstanceId: string;
  /** 此連線代表下一條為優先路線或次要路線；缺省視為優先 */
  nextKind?: ShiftRouteRelationNextKind;
};

export function resolveRouteRelationNextKind(
  link: Pick<ShiftRouteRelationLink, 'nextKind'> | null | undefined,
): ShiftRouteRelationNextKind {
  return link?.nextKind === 'secondary' ? 'secondary' : 'priority';
}

function parseRouteRelationNextKind(raw: unknown): ShiftRouteRelationNextKind {
  // secondary / 舊值 backup
  if (raw === 'secondary' || raw === 'backup') return 'secondary';
  // priority / 舊值 primary / 缺省
  return 'priority';
}

export type ShiftRouteRelationGraph = {
  nodes: ShiftRouteRelationNode[];
  links: ShiftRouteRelationLink[];
};

export const EMPTY_ROUTE_RELATION_GRAPH: ShiftRouteRelationGraph = {
  nodes: [],
  links: [],
};

const TILE_W = 148;
const TILE_H = 78;
const LAYOUT_PAD = 28;
const LAYOUT_GAP_X = 196;
const LAYOUT_GAP_Y = 128;

export const ROUTE_RELATION_TILE = {
  width: TILE_W,
  height: TILE_H,
} as const;

export function createRouteRelationLinkId(
  fromInstanceId: string,
  toInstanceId: string,
): string {
  return `rel:${fromInstanceId}->${toInstanceId}`;
}

export function emptyShiftRouteRelationGraph(): ShiftRouteRelationGraph {
  return { nodes: [], links: [] };
}

export function parseShiftRouteRelationGraph(raw: unknown): ShiftRouteRelationGraph {
  if (!raw || typeof raw !== 'object') return emptyShiftRouteRelationGraph();
  const o = raw as Record<string, unknown>;
  const nodesRaw = Array.isArray(o.nodes) ? o.nodes : [];
  const linksRaw = Array.isArray(o.links) ? o.links : [];
  const nodes: ShiftRouteRelationNode[] = [];
  const seenNodes = new Set<string>();

  for (const item of nodesRaw) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const instanceId = typeof n.instanceId === 'string' ? n.instanceId.trim() : '';
    if (!instanceId || seenNodes.has(instanceId)) continue;
    const x = typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : LAYOUT_PAD;
    const y = typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : LAYOUT_PAD;
    seenNodes.add(instanceId);
    nodes.push({ instanceId, x, y });
  }

  const nodeIds = new Set(nodes.map((n) => n.instanceId));
  const links: ShiftRouteRelationLink[] = [];
  const seenLinks = new Set<string>();

  for (const item of linksRaw) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const fromInstanceId =
      typeof l.fromInstanceId === 'string' ? l.fromInstanceId.trim() : '';
    const toInstanceId = typeof l.toInstanceId === 'string' ? l.toInstanceId.trim() : '';
    if (!fromInstanceId || !toInstanceId || fromInstanceId === toInstanceId) continue;
    if (!nodeIds.has(fromInstanceId) || !nodeIds.has(toInstanceId)) continue;
    const id =
      typeof l.id === 'string' && l.id.trim()
        ? l.id.trim()
        : createRouteRelationLinkId(fromInstanceId, toInstanceId);
    if (seenLinks.has(id) || seenLinks.has(`${fromInstanceId}->${toInstanceId}`)) {
      continue;
    }
    seenLinks.add(id);
    seenLinks.add(`${fromInstanceId}->${toInstanceId}`);
    const nextKind = parseRouteRelationNextKind(l.nextKind);
    links.push({
      id,
      fromInstanceId,
      toInstanceId,
      ...(nextKind === 'secondary' ? { nextKind: 'secondary' as const } : {}),
    });
  }

  return { nodes, links };
}

function defaultNodePosition(index: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(total, 1))));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: LAYOUT_PAD + col * LAYOUT_GAP_X,
    y: LAYOUT_PAD + row * LAYOUT_GAP_Y,
  };
}

/**
 * 與目前已選主路線對帳：移除失效方格／連線，補上新路線的預設位置。
 */
export function syncRouteRelationGraphWithRoutes(
  graph: ShiftRouteRelationGraph | null | undefined,
  routes: RouteLike[],
): ShiftRouteRelationGraph {
  const base = graph ?? emptyShiftRouteRelationGraph();
  const aliveIds = new Set(routes.map((route) => resolveInstanceId(route)));
  const prevById = new Map(base.nodes.map((node) => [node.instanceId, node] as const));
  const nextNodes: ShiftRouteRelationNode[] = [];

  routes.forEach((route, index) => {
    const instanceId = resolveInstanceId(route);
    const prev = prevById.get(instanceId);
    if (prev) {
      nextNodes.push({ ...prev });
      return;
    }
    const layout = defaultNodePosition(index, routes.length);
    nextNodes.push({ instanceId, x: layout.x, y: layout.y });
  });

  const nextIds = new Set(nextNodes.map((n) => n.instanceId));
  const links = base.links.filter(
    (link) =>
      aliveIds.has(link.fromInstanceId)
      && aliveIds.has(link.toInstanceId)
      && nextIds.has(link.fromInstanceId)
      && nextIds.has(link.toInstanceId)
      && link.fromInstanceId !== link.toInstanceId,
  );

  return { nodes: nextNodes, links };
}

export function updateRouteRelationNodePosition(
  graph: ShiftRouteRelationGraph,
  instanceId: string,
  x: number,
  y: number,
): ShiftRouteRelationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.instanceId === instanceId ? { ...node, x, y } : node,
    ),
  };
}

export function addRouteRelationLink(
  graph: ShiftRouteRelationGraph,
  fromInstanceId: string,
  toInstanceId: string,
): ShiftRouteRelationGraph {
  if (!fromInstanceId || !toInstanceId || fromInstanceId === toInstanceId) return graph;
  const exists = graph.links.some(
    (link) =>
      link.fromInstanceId === fromInstanceId && link.toInstanceId === toInstanceId,
  );
  if (exists) return graph;
  return {
    ...graph,
    links: [
      ...graph.links,
      {
        id: createRouteRelationLinkId(fromInstanceId, toInstanceId),
        fromInstanceId,
        toInstanceId,
      },
    ],
  };
}

export function removeRouteRelationLink(
  graph: ShiftRouteRelationGraph,
  linkId: string,
): ShiftRouteRelationGraph {
  return {
    ...graph,
    links: graph.links.filter((link) => link.id !== linkId),
  };
}

/** 設定連線指向下一條路線的優先／次要角色 */
export function updateRouteRelationLinkNextKind(
  graph: ShiftRouteRelationGraph,
  linkId: string,
  nextKind: ShiftRouteRelationNextKind,
): ShiftRouteRelationGraph {
  const kind = nextKind === 'secondary' ? 'secondary' : 'priority';
  return {
    ...graph,
    links: graph.links.map((link) => {
      if (link.id !== linkId) return link;
      if (kind === 'priority') {
        return {
          id: link.id,
          fromInstanceId: link.fromInstanceId,
          toInstanceId: link.toInstanceId,
        };
      }
      return { ...link, nextKind: 'secondary' };
    }),
  };
}

/**
 * 重接連線一端到新方塊。
 * `end === 'from'` 改起點；`end === 'to'` 改終點。
 */
export function reconnectRouteRelationLink(
  graph: ShiftRouteRelationGraph,
  linkId: string,
  end: 'from' | 'to',
  newInstanceId: string,
): ShiftRouteRelationGraph {
  const link = graph.links.find((item) => item.id === linkId);
  if (!link || !newInstanceId.trim()) return graph;

  const nextFrom = end === 'from' ? newInstanceId.trim() : link.fromInstanceId;
  const nextTo = end === 'to' ? newInstanceId.trim() : link.toInstanceId;
  if (nextFrom === nextTo) return graph;

  const without = graph.links.filter((item) => item.id !== linkId);
  const duplicate = without.some(
    (item) => item.fromInstanceId === nextFrom && item.toInstanceId === nextTo,
  );
  if (duplicate) {
    return { ...graph, links: without };
  }

  const nextKind = resolveRouteRelationNextKind(link);
  return {
    ...graph,
    links: [
      ...without,
      {
        id: createRouteRelationLinkId(nextFrom, nextTo),
        fromInstanceId: nextFrom,
        toInstanceId: nextTo,
        ...(nextKind === 'secondary' ? { nextKind: 'secondary' as const } : {}),
      },
    ],
  };
}

/** 反轉連線方向（A→B 變 B→A）；若反向已存在則刪除原向 */
export function reverseRouteRelationLink(
  graph: ShiftRouteRelationGraph,
  linkId: string,
): ShiftRouteRelationGraph {
  const link = graph.links.find((item) => item.id === linkId);
  if (!link) return graph;
  const without = graph.links.filter((item) => item.id !== linkId);
  const reversedExists = without.some(
    (item) =>
      item.fromInstanceId === link.toInstanceId
      && item.toInstanceId === link.fromInstanceId,
  );
  if (reversedExists) {
    return { ...graph, links: without };
  }
  const nextKind = resolveRouteRelationNextKind(link);
  return {
    ...graph,
    links: [
      ...without,
      {
        id: createRouteRelationLinkId(link.toInstanceId, link.fromInstanceId),
        fromInstanceId: link.toInstanceId,
        toInstanceId: link.fromInstanceId,
        ...(nextKind === 'secondary' ? { nextKind: 'secondary' as const } : {}),
      },
    ],
  };
}

export function resolveRouteOriginStation(route: RouteLike): {
  stationId: string;
  stationName: string;
} | null {
  const stationId = route.stationIds[0]?.trim();
  if (!stationId) return null;
  const dwell = route.stationDwells.find((item) => item.stationId === stationId);
  return {
    stationId,
    stationName: dwell?.stationName?.trim() || stationId,
  };
}

export function resolveRouteTerminalStation(route: RouteLike): {
  stationId: string;
  stationName: string;
} | null {
  const stationId = route.stationIds[route.stationIds.length - 1]?.trim();
  if (!stationId) return null;
  const dwell = route.stationDwells.find((item) => item.stationId === stationId);
  return {
    stationId,
    stationName: dwell?.stationName?.trim() || stationId,
  };
}

/** 接續點是否同一站（前線終站＝後線起站） */
export function isRouteRelationJunctionMatched(
  from: RouteLike,
  to: RouteLike,
): boolean {
  const terminal = resolveRouteTerminalStation(from);
  const origin = resolveRouteOriginStation(to);
  if (!terminal || !origin) return false;
  return terminal.stationId === origin.stationId;
}

/** 兩條路線接續後的行駛加總（快＝min 加總；均＝avg 加總）；接續站不一致時為 null */
export function resolveLinkedRouteTravelTotals(
  from: RouteLike,
  to: RouteLike,
): { minSeconds: number | null; avgSeconds: number | null } {
  if (!isRouteRelationJunctionMatched(from, to)) {
    return { minSeconds: null, avgSeconds: null };
  }
  const minA = from.minTravelTimeSeconds;
  const minB = to.minTravelTimeSeconds;
  const avgA = from.avgTravelTimeSeconds;
  const avgB = to.avgTravelTimeSeconds;
  return {
    minSeconds:
      minA != null && minB != null && minA > 0 && minB > 0
        ? Math.round(minA + minB)
        : null,
    avgSeconds:
      avgA != null && avgB != null && avgA > 0 && avgB > 0
        ? Math.round(avgA + avgB)
        : null,
  };
}
