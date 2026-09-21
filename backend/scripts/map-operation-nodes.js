/**
 * 地圖 DockingPoint ↔ 營運站點橋接（前後端腳本共用）
 *
 * - 從 MapFileV2 擷取 stationId、別名、座標
 * - stationId 為停靠點唯一識別（例 station_1）
 * - 不依賴 dockingLeg（已廢止）；routeId 僅在顯示名稱含「上行／下行」時推斷（相容舊 demo）
 */
const fs = require('fs');
const path = require('path');
const {
  resolveMapJsonPath: resolvePublishedOrBuiltinMapPath,
} = require('./map-published-store');

const DOCKING_POINT_STATION_ID_KEY = 'stationId';
const DOCKING_POINT_STATION_NAME_KEY = 'stationName';
/** @deprecated */
const DOCKING_POINT_STATION_KEY = 'dockingStation';

function resolveMapJsonPath(mapId) {
  return resolvePublishedOrBuiltinMapPath(mapId);
}

function normalizeStationNameInput(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function parseDockingStation(raw) {
  if (raw === 'N2W' || raw === 'T3' || raw === 'S2W') return raw;
  return null;
}

function defaultStationDisplayName(dockingStation) {
  const station = parseDockingStation(dockingStation);
  if (!station) return '';
  return station;
}

function effectiveStationName(facility, params) {
  const custom = normalizeStationNameInput(facility?.customName);
  if (custom) return custom;
  const name = normalizeStationNameInput(params?.[DOCKING_POINT_STATION_NAME_KEY]);
  if (name) return name;
  return defaultStationDisplayName(params?.[DOCKING_POINT_STATION_KEY]);
}

/** 僅相容舊 T3 demo：從顯示名稱推斷正線 routeId；泛用圖台可無此欄位 */
function routeIdFromStationName(stationName) {
  const name = String(stationName ?? '');
  if (name.includes('下行')) return 'ROUTE-MAINLINE-DOWN';
  if (name.includes('上行')) return 'ROUTE-MAINLINE-UP';
  return null;
}

/**
 * @param {object} map - MapFileV2
 * @returns {import('./map-operation-nodes.types').OperationNodeRegistry}
 */
function collectStationsFromMap(map) {
  const stations = [];
  const byId = new Map();
  const byRouteStationAction = new Map();

  for (const area of map?.areas ?? []) {
    for (const facility of area?.facilities ?? []) {
      if (facility?.type !== 'DockingPoint') continue;

      const params = facility.parameters ?? {};
      const xM = params.refFieldXM;
      const yM = params.refFieldYM;
      if (typeof xM !== 'number' || typeof yM !== 'number') continue;

      const stationId = String(params[DOCKING_POINT_STATION_ID_KEY] ?? '').trim();
      if (!stationId) continue;

      const stationName = effectiveStationName(facility, params) || stationId;
      const routeId = routeIdFromStationName(stationName);

      const entry = {
        stationId,
        stationName,
        routeId: routeId ?? undefined,
        xM,
        yM,
        facilityId: String(facility.id),
        areaId: String(area.id),
      };

      stations.push(entry);
      byId.set(stationId, entry);

      if (routeId) {
        byRouteStationAction.set(`${routeId}|${stationId}|PLATFORM_DOCKING`, entry);
        byRouteStationAction.set(`${routeId}|${stationId}|STATION_DEPARTURE`, entry);
      }
    }
  }

  return {
    stations,
    nodes: stations,
    byId,
    byRouteStationAction,
    mapId: map?.mapId ?? null,
  };
}

/** @deprecated 相容舊名稱 */
function collectOperationNodesFromMap(map) {
  return collectStationsFromMap(map);
}

/**
 * 依檔案修改時間快取。訂單列表每筆訂單、每個端點都會來查站點，沒快取時每次都把整張
 * 地圖 JSON 讀進來重新 parse，一秒內就佔掉好幾百毫秒；事件迴圈被吃住，MQTT 遙測就
 * 一批一批才轉出去，前端的車輛便走走停停。
 */
const stationRegistryCache = new Map();

function loadStationsFromMapFile(mapPath) {
  const mtimeMs = fs.statSync(mapPath).mtimeMs;
  const cached = stationRegistryCache.get(mapPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.registry;
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const registry = collectStationsFromMap(map);
  stationRegistryCache.set(mapPath, { mtimeMs, registry });
  return registry;
}

function loadOperationNodesFromMapFile(mapPath) {
  return loadStationsFromMapFile(mapPath);
}

function loadOperationNodeRegistry(mapId = 't3-main-version') {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) {
    return {
      stations: [],
      nodes: [],
      byId: new Map(),
      byRouteStationAction: new Map(),
      mapId: null,
    };
  }
  try {
    return loadStationsFromMapFile(mapPath);
  } catch {
    return {
      stations: [],
      nodes: [],
      byId: new Map(),
      byRouteStationAction: new Map(),
      mapId: null,
    };
  }
}

function resolveStationById(registry, stationId) {
  return registry?.byId?.get(stationId) ?? null;
}

/** @deprecated 請改用 resolveStationById */
function resolveNodeIdForRouteAction(registry, routeId, stationId, actionType) {
  const key = `${routeId}|${stationId}|${actionType}`;
  const hit = registry?.byRouteStationAction?.get(key);
  return hit?.stationId ?? null;
}

function distanceM(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  collectStationsFromMap,
  collectOperationNodesFromMap,
  loadStationsFromMapFile,
  loadOperationNodesFromMapFile,
  loadOperationNodeRegistry,
  resolveMapJsonPath,
  resolveStationById,
  resolveNodeIdForRouteAction,
  distanceM,
};
