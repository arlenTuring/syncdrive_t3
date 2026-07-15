/**
 * 從 MapFileV2 擷取途經點（Waypoint）
 */
const fs = require('fs');
const path = require('path');

const { resolveMapJsonPath } = require('./map-operation-nodes');

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
      if (String(entry.type ?? '').trim() !== 'Waypoint') continue;
      const waypointCode = normalizeCode(entry.parameters?.waypointCode);
      if (!waypointCode) continue;

      items.push({
        waypointCode,
        facilityId: String(entry.id ?? ''),
        areaId: String(area.id ?? ''),
        areaName: String(area.customName ?? area.id ?? ''),
      });
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
