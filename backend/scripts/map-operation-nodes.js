/**
 * 地圖 DockingPoint ↔ 營運路線 node_id 橋接（前後端腳本共用）
 *
 * - 從 MapFileV2 擷取 operationNodeId、座標、站點
 * - T3 正線：依 dockingLeg + dockingStation 推斷節點角色（STOP / DEP）
 * - 格式：ND-{站點代碼}-{節點角色}-{序號}
 */
const fs = require('fs');
const path = require('path');

const NODE_ID_PATTERN = /^ND-[A-Z0-9_]+-[A-Z0-9_]+-\d{2}$/;

const DOCKING_POINT_NODE_ID_KEY = 'operationNodeId';
const DOCKING_POINT_STATION_NAME_KEY = 'stationName';
const DOCKING_POINT_NODE_ROLE_KEY = 'nodeRole';
const DOCKING_POINT_LEG_KEY = 'dockingLeg';
const DOCKING_POINT_STATION_KEY = 'dockingStation';

/** T3 正線：物理停靠點 → 協議節點角色 */
const MAINLINE_DOCKING_NODE_ROLES = {
  down: { N2W: 'DEP', T3: 'STOP', S2W: 'STOP' },
  up: { N2W: 'STOP', T3: 'STOP', S2W: 'DEP' },
};

const DEFAULT_MAP_PATHS = {
  't3-main-version': path.join(
    __dirname,
    '../../frontend/public/maps/t3-main-version.json',
  ),
};

function resolveMapJsonPath(mapId) {
  const key = String(mapId ?? '').trim();
  if (!key) return null;
  if (DEFAULT_MAP_PATHS[key]) return DEFAULT_MAP_PATHS[key];
  const candidate = path.join(
    __dirname,
    '../../frontend/public/maps',
    `${key}.json`,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

function normalizeStationNameInput(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function stationNameToNodeToken(stationName) {
  const n = normalizeStationNameInput(stationName);
  if (!n) return '';
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(n)) {
    return n.toUpperCase().replace(/-/g, '_');
  }
  const slug = n
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 24);
  return slug || 'STATION';
}

function parseDockingLeg(raw) {
  if (raw === 'down' || raw === 'up') return raw;
  return null;
}

function parseDockingStation(raw) {
  if (raw === 'N2W' || raw === 'T3' || raw === 'S2W') return raw;
  return null;
}

function inferMainlineNodeRole(dockingLeg, dockingStation) {
  const leg = parseDockingLeg(dockingLeg);
  const station = parseDockingStation(dockingStation);
  if (!leg || !station) return null;
  return MAINLINE_DOCKING_NODE_ROLES[leg]?.[station] ?? 'STOP';
}

function routeIdForDockingLeg(dockingLeg) {
  const leg = parseDockingLeg(dockingLeg);
  if (leg === 'down') return 'ROUTE-MAINLINE-DOWN';
  if (leg === 'up') return 'ROUTE-MAINLINE-UP';
  return null;
}

function generateOperationNodeId(stationToken, existingIds, nodeRole = 'STOP') {
  const station = stationNameToNodeToken(stationToken);
  if (!station) throw new Error('站點代碼不可為空');
  const base = `ND-${station}-${nodeRole}`;
  let seq = 1;
  let id = `${base}-${String(seq).padStart(2, '0')}`;
  while (existingIds.has(id)) {
    seq += 1;
    id = `${base}-${String(seq).padStart(2, '0')}`;
  }
  return id;
}

function getStationTokenFromParams(params) {
  const dockingStation = parseDockingStation(params?.[DOCKING_POINT_STATION_KEY]);
  if (dockingStation) return dockingStation;
  const stationName = normalizeStationNameInput(params?.[DOCKING_POINT_STATION_NAME_KEY]);
  if (!stationName) return '';
  if (/^(N2W|T3|S2W)$/i.test(stationName)) return stationName.toUpperCase();
  return stationNameToNodeToken(stationName);
}

function resolveNodeRoleFromParams(params) {
  const explicit = String(params?.[DOCKING_POINT_NODE_ROLE_KEY] ?? '').trim().toUpperCase();
  if (explicit) return explicit;
  return inferMainlineNodeRole(
    params?.[DOCKING_POINT_LEG_KEY],
    params?.[DOCKING_POINT_STATION_KEY],
  ) ?? 'STOP';
}

function defaultStationDisplayName(dockingLeg, dockingStation) {
  const leg = parseDockingLeg(dockingLeg);
  const station = parseDockingStation(dockingStation);
  if (!leg || !station) return '';
  return `${station}${leg === 'down' ? '下行' : '上行'}`;
}

function ensureDockingPointParams(params, existingIds, canonicalByStationRole = new Map()) {
  const next = { ...(params ?? {}) };
  const leg = parseDockingLeg(next[DOCKING_POINT_LEG_KEY]);
  const routeStation = parseDockingStation(next[DOCKING_POINT_STATION_KEY]);

  if (!normalizeStationNameInput(next[DOCKING_POINT_STATION_NAME_KEY]) && leg && routeStation) {
    next[DOCKING_POINT_STATION_NAME_KEY] = defaultStationDisplayName(leg, routeStation);
  }

  const nodeRole = resolveNodeRoleFromParams(next);
  next[DOCKING_POINT_NODE_ROLE_KEY] = nodeRole;

  const existingNodeId = String(next[DOCKING_POINT_NODE_ID_KEY] ?? '').trim();
  if (!existingNodeId) {
    const stationToken = getStationTokenFromParams(next);
    if (stationToken) {
      const canonKey = `${stationToken}|${nodeRole}`;
      let nodeId = canonicalByStationRole.get(canonKey);
      if (!nodeId) {
        nodeId = generateOperationNodeId(stationToken, existingIds, nodeRole);
        canonicalByStationRole.set(canonKey, nodeId);
      }
      next[DOCKING_POINT_NODE_ID_KEY] = nodeId;
      existingIds.add(nodeId);
    }
  } else if (NODE_ID_PATTERN.test(existingNodeId)) {
    existingIds.add(existingNodeId);
    const stationToken = getStationTokenFromParams(next);
    if (stationToken) {
      canonicalByStationRole.set(`${stationToken}|${nodeRole}`, existingNodeId);
    }
  }

  return next;
}

/**
 * @param {object} map - MapFileV2
 * @returns {import('./map-operation-nodes.types').OperationNodeRegistry}
 */
function collectOperationNodesFromMap(map) {
  const nodes = [];
  const byId = new Map();
  const byRouteStationAction = new Map();
  const existingIds = new Set();
  const canonicalByStationRole = new Map();

  for (const area of map?.areas ?? []) {
    for (const facility of area?.facilities ?? []) {
      if (facility?.type !== 'DockingPoint') continue;

      const params = ensureDockingPointParams(
        facility.parameters ?? {},
        existingIds,
        canonicalByStationRole,
      );
      const xM = params.refFieldXM;
      const yM = params.refFieldYM;
      if (typeof xM !== 'number' || typeof yM !== 'number') continue;

      const dockingLeg = parseDockingLeg(params[DOCKING_POINT_LEG_KEY]);
      const routeStation = parseDockingStation(params[DOCKING_POINT_STATION_KEY]);
      const nodeId = String(params[DOCKING_POINT_NODE_ID_KEY] ?? '').trim();
      if (!nodeId) continue;

      const nodeRole = resolveNodeRoleFromParams(params);
      const routeId = routeIdForDockingLeg(dockingLeg);
      const actionType =
        nodeRole === 'DEP' ? 'STATION_DEPARTURE' : 'PLATFORM_DOCKING';

      const entry = {
        nodeId,
        nodeRole,
        stationName: normalizeStationNameInput(params[DOCKING_POINT_STATION_NAME_KEY]),
        routeStation: routeStation ?? undefined,
        dockingLeg: dockingLeg ?? undefined,
        routeId: routeId ?? undefined,
        actionType,
        xM,
        yM,
        facilityId: String(facility.id),
        areaId: String(area.id),
      };

      nodes.push(entry);
      byId.set(nodeId, entry);

      if (routeId && routeStation) {
        byRouteStationAction.set(`${routeId}|${routeStation}|${actionType}`, entry);
      }
    }
  }

  return { nodes, byId, byRouteStationAction, mapId: map?.mapId ?? null };
}

function loadOperationNodesFromMapFile(mapPath) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  return collectOperationNodesFromMap(map);
}

function loadOperationNodeRegistry(mapId = 't3-main-version') {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) {
    return { nodes: [], byId: new Map(), byRouteStationAction: new Map(), mapId: null };
  }
  try {
    return loadOperationNodesFromMapFile(mapPath);
  } catch {
    return { nodes: [], byId: new Map(), byRouteStationAction: new Map(), mapId: null };
  }
}

function resolveNodeIdForRouteAction(registry, routeId, stationId, actionType) {
  const key = `${routeId}|${stationId}|${actionType}`;
  const fromMap = registry.byRouteStationAction.get(key);
  if (fromMap?.nodeId) return fromMap.nodeId;
  return null;
}

function distanceM(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

module.exports = {
  DOCKING_POINT_NODE_ID_KEY,
  DOCKING_POINT_STATION_NAME_KEY,
  DOCKING_POINT_NODE_ROLE_KEY,
  DOCKING_POINT_LEG_KEY,
  DOCKING_POINT_STATION_KEY,
  MAINLINE_DOCKING_NODE_ROLES,
  NODE_ID_PATTERN,
  resolveMapJsonPath,
  normalizeStationNameInput,
  stationNameToNodeToken,
  parseDockingLeg,
  parseDockingStation,
  inferMainlineNodeRole,
  routeIdForDockingLeg,
  generateOperationNodeId,
  defaultStationDisplayName,
  ensureDockingPointParams,
  collectOperationNodesFromMap,
  loadOperationNodesFromMapFile,
  loadOperationNodeRegistry,
  resolveNodeIdForRouteAction,
  distanceM,
};
