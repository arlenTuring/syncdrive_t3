/**
 * 從 MapFileV2 擷取途經點：
 * - kind: 'waypoint'＝一般途經點（Waypoint 設施）
 * - kind: 'crossover-waypoint'＝虛擬渡線途經點（TrackCrossover 端點 A／B）
 * 兩者功能相同（可入路線／拓樸），資料來源與分類分開。
 */
const fs = require('fs');
const path = require('path');

const { resolveMapJsonPath } = require('./map-operation-nodes');

/** 現場座標優先，沒有就退回圖面座標 */
function fieldMeter(refField, canvas) {
  if (typeof refField === 'number' && Number.isFinite(refField)) return refField;
  return typeof canvas === 'number' && Number.isFinite(canvas) ? canvas : undefined;
}

function normalizeCode(raw) {
  return String(raw ?? '').trim();
}

function loadWaypointsFromMapFile(mapPath) {
  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);
  const areas = Array.isArray(map.areas) ? map.areas : [];
  const items = [];

  for (const area of areas) {
    const facilities = Array.isArray(area.facilities) ? area.facilities : [];
    for (const entry of facilities) {
      const type = String(entry.type ?? '').trim();
      if (type === 'Waypoint') {
        const waypointCode = normalizeCode(entry.parameters?.waypointCode);
        if (!waypointCode) continue;

        items.push({
          waypointCode,
          facilityId: String(entry.id ?? ''),
          areaId: String(area.id ?? ''),
          areaName: String(area.customName ?? area.id ?? ''),
          kind: 'waypoint',
          kindLabel: '途經點',
        });
        continue;
      }

      if (type !== 'TrackCrossover') continue;
      const portals = entry.parameters?.trackCrossoverPortals;
      if (!portals || typeof portals !== 'object') continue;
      for (const portalKey of ['a', 'b']) {
        const portal = portals[portalKey];
        if (!portal || typeof portal !== 'object') continue;
        const waypointCode = normalizeCode(portal.waypointCode);
        if (!waypointCode) continue;
        items.push({
          waypointCode,
          facilityId: String(entry.id ?? ''),
          areaId: String(area.id ?? ''),
          areaName: String(area.customName ?? area.id ?? ''),
          kind: 'crossover-waypoint',
          kindLabel: '虛擬渡線途經點',
          portalKey,
          topologyNodeId: `xowp:${String(entry.id ?? '')}:${portalKey}`,
          alias: normalizeCode(portal.alias) || undefined,
          // 現場座標優先。端點有兩對座標：xM／yM 是圖面位置（畫給人看的），
          // refFieldXM／refFieldYM 是現場實際位置。對外要的是後者——車輛拿它
          // 定位，取到圖面座標會讓車開到不存在的地方。
          //
          // 舊圖資沒有 refField，退回 xM／yM：在兩者分家之前，那一對本來就同時
          // 扮演兩個角色。
          xM: fieldMeter(portal.refFieldXM, portal.xM),
          yM: fieldMeter(portal.refFieldYM, portal.yM),
        });
      }
    }
  }

  items.sort((a, b) =>
    a.waypointCode.localeCompare(b.waypointCode, undefined, { numeric: true }),
  );

  return {
    mapId: map.mapId ?? path.basename(mapPath, '.json'),
    items,
  };
}

function loadWaypoints(mapId) {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  return loadWaypointsFromMapFile(mapPath);
}

module.exports = {
  loadWaypoints,
  loadWaypointsFromMapFile,
};
