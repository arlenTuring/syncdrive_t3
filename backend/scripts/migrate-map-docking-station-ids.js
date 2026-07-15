#!/usr/bin/env node
/**
 * 將地圖 DockingPoint 遷移至 stationId 模型（station_1…station_N）
 * 用法：node backend/scripts/migrate-map-docking-station-ids.js [mapPath]
 */
const fs = require('fs');
const path = require('path');

const mapPath =
  process.argv[2]
  ?? path.join(__dirname, '../../frontend/public/maps/t3-main-version.json');

const STATION_ORDER = [
  'N2W上行',
  'N2W下行',
  'T3下行',
  'T3上行',
  'S2W下行',
  'S2W上行',
];

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
let seq = 0;
let changed = 0;

for (const area of map.areas ?? []) {
  for (const facility of area.facilities ?? []) {
    if (facility.type !== 'DockingPoint') continue;
    const params = facility.parameters ?? {};
    const name = String(params.stationName ?? '').trim();
    seq += 1;
    const preferredIndex = STATION_ORDER.indexOf(name);
    const stationId =
      preferredIndex >= 0 ? `station_${preferredIndex + 1}` : `station_${seq}`;

    facility.parameters = {
      ...params,
      stationId,
      stationName: name || params.stationName || stationId,
    };
    delete facility.parameters.operationNodeId;
    delete facility.parameters.dockingStation;
    delete facility.parameters.nodeRole;
    changed += 1;
  }
}

fs.writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
console.log(`Migrated ${changed} docking points in ${mapPath}`);
