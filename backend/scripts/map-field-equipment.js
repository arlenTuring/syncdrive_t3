/**
 * 從 MapFileV2 擷取場域物件（設備＋大型設施區塊）
 *
 * 分類（與圖台 facilityTaxonomy 對齊）：
 * - equipment：Signal 紅綠燈、Pole 智慧桿、PSD 月台門
 * - facility：Facility 大型區塊（充電格／停車格／維修格等，依 purpose）
 */
const fs = require('fs');
const path = require('path');

const { resolveMapJsonPath } = require('./map-operation-nodes');

const OBJECT_CATEGORY = {
  EQUIPMENT: 'equipment',
  FACILITY: 'facility',
};

const EQUIPMENT_KIND = {
  SIGNAL: 'signal',
  SMART_POLE: 'smart_pole',
  PLATFORM_DOOR: 'platform_door',
  CHARGING: 'charging',
  CAR_WASH: 'car_wash',
  MAINTENANCE: 'maintenance',
  YARD_SLOT: 'yard_slot',
  OTHER: 'other',
};

function normalizeCode(raw) {
  return String(raw ?? '').trim();
}

function classifyMapObject(entry) {
  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();
  const type = String(entry.type ?? '').trim();

  // 設備：依元件 type，不依 Facility.purpose 文字
  if (type === 'Signal') {
    return { category: OBJECT_CATEGORY.EQUIPMENT, kind: EQUIPMENT_KIND.SIGNAL };
  }
  if (type === 'Pole') {
    return { category: OBJECT_CATEGORY.EQUIPMENT, kind: EQUIPMENT_KIND.SMART_POLE };
  }
  if (type === 'PSD') {
    return { category: OBJECT_CATEGORY.EQUIPMENT, kind: EQUIPMENT_KIND.PLATFORM_DOOR };
  }

  // 大型設施區塊
  if (type === 'Facility') {
    if (purpose === '充電格' || /^E\d+/i.test(code)) {
      return { category: OBJECT_CATEGORY.FACILITY, kind: EQUIPMENT_KIND.CHARGING };
    }
    if (purpose === '洗車格' || /^W\d+/i.test(code)) {
      return { category: OBJECT_CATEGORY.FACILITY, kind: EQUIPMENT_KIND.CAR_WASH };
    }
    if (purpose === '保養格' || purpose === '維修格' || /^M\d+/i.test(code)) {
      return { category: OBJECT_CATEGORY.FACILITY, kind: EQUIPMENT_KIND.MAINTENANCE };
    }
    const yardPurposes = ['臨停格', '調度格', '停車格'];
    if (yardPurposes.includes(purpose) || /^[PH]\d+/i.test(code)) {
      return { category: OBJECT_CATEGORY.FACILITY, kind: EQUIPMENT_KIND.YARD_SLOT };
    }
    return { category: OBJECT_CATEGORY.FACILITY, kind: EQUIPMENT_KIND.OTHER };
  }

  return null;
}

function stationHintFromAreaName(areaName) {
  const raw = String(areaName ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^Area\s+\S+\s+·\s+/i, '').replace(/\s*站台\s*$/, '').trim() || raw;
}

function equipmentLabel(entry, kind, areaName) {
  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();
  if (code && purpose) return `${code}（${purpose}）`;
  if (code) return code;
  if (kind === EQUIPMENT_KIND.PLATFORM_DOOR) {
    const station = stationHintFromAreaName(areaName);
    const id = String(entry.id ?? '').trim();
    if (station && id) return `${station} · ${id}`;
    if (station) return `${station} 月台門`;
    return id ? `月台門 ${id}` : '月台門';
  }
  return purpose || entry.id || '未命名';
}

function matchesKindFilter(classified, entry, kindFilter) {
  if (kindFilter === 'all') return true;
  if (classified.kind === kindFilter) return true;
  if (kindFilter === OBJECT_CATEGORY.EQUIPMENT) {
    return classified.category === OBJECT_CATEGORY.EQUIPMENT;
  }
  if (kindFilter === OBJECT_CATEGORY.FACILITY) {
    return classified.category === OBJECT_CATEGORY.FACILITY;
  }

  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();

  if (kindFilter === EQUIPMENT_KIND.CAR_WASH) {
    return purpose === '洗車格' || /^W\d+/i.test(code);
  }

  if (kindFilter === EQUIPMENT_KIND.MAINTENANCE) {
    return purpose === '保養格' || purpose === '維修格' || /^M\d+/i.test(code);
  }

  return false;
}

function loadFieldEquipmentFromMapFile(mapPath, kindFilter = 'all') {
  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);
  const areas = Array.isArray(map.areas) ? map.areas : [];
  const items = [];

  for (const area of areas) {
    const facilities = Array.isArray(area.facilities) ? area.facilities : [];
    for (const entry of facilities) {
      const classified = classifyMapObject(entry);
      if (!classified) continue;
      if (!matchesKindFilter(classified, entry, kindFilter)) continue;

      const mapCode = normalizeCode(entry.customName) || String(entry.id ?? '');
      if (!mapCode) continue;

      const areaName = String(area.customName ?? area.id ?? '');
      items.push({
        equipmentId: String(entry.id ?? ''),
        mapCode,
        equipmentKind: classified.kind,
        objectCategory: classified.category,
        label: equipmentLabel(entry, classified.kind, areaName),
        purpose: String(entry.parameters?.purpose ?? '').trim() || undefined,
        mqttInstanceId: entry.parameters?.mqttInstanceId
          ? String(entry.parameters.mqttInstanceId)
          : undefined,
        areaId: String(area.id ?? ''),
        areaName,
        facilityType: String(entry.type ?? ''),
      });
    }
  }

  items.sort((a, b) => a.mapCode.localeCompare(b.mapCode, undefined, { numeric: true }));

  return {
    mapId: map.mapId ?? path.basename(mapPath, '.json'),
    items,
  };
}

function loadFieldEquipment(mapId, kindFilter = 'all') {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  return loadFieldEquipmentFromMapFile(mapPath, kindFilter);
}

/**
 * 取設施（Facility 類）的場域參照範圍。與 `t3-v0-0-5-track-motion.js` 內部同名邏輯
 * 對齊，但搬到這裡讓 backend/src 能直接匯入重用（原本只有模擬器腳本能用）。
 */
function getRefFieldBounds(params) {
  const p = params ?? {};
  const xMinM = p.refFieldXMinM;
  const xMaxM = p.refFieldXMaxM;
  const yMinM = p.refFieldYMinM;
  const yMaxM = p.refFieldYMaxM;
  if (
    typeof xMinM === 'number' && Number.isFinite(xMinM)
    && typeof xMaxM === 'number' && Number.isFinite(xMaxM)
    && typeof yMinM === 'number' && Number.isFinite(yMinM)
    && typeof yMaxM === 'number' && Number.isFinite(yMaxM)
  ) {
    return { xMinM, xMaxM, yMinM, yMaxM };
  }
  return null;
}

/** 設施中心點：有範圍取範圍中心，否則退回單點座標（若有）。 */
function facilityCenterMeters(entry) {
  const params = entry.parameters ?? {};
  const bounds = getRefFieldBounds(params);
  if (bounds) {
    return {
      xM: (bounds.xMinM + bounds.xMaxM) / 2,
      yM: (bounds.yMinM + bounds.yMaxM) / 2,
    };
  }
  const xM = params.refFieldXM;
  const yM = params.refFieldYM;
  if (typeof xM === 'number' && Number.isFinite(xM) && typeof yM === 'number' && Number.isFinite(yM)) {
    return { xM, yM };
  }
  return null;
}

/** 載入所有 facility 類設施的幾何資料（中心點＋範圍），供座標查詢重用。 */
function loadFacilityGeometryFromMapFile(mapPath) {
  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);
  const areas = Array.isArray(map.areas) ? map.areas : [];
  const items = [];

  for (const area of areas) {
    const facilities = Array.isArray(area.facilities) ? area.facilities : [];
    for (const entry of facilities) {
      const classified = classifyMapObject(entry);
      if (!classified || classified.category !== OBJECT_CATEGORY.FACILITY) continue;
      const center = facilityCenterMeters(entry);
      if (!center) continue;

      items.push({
        equipmentId: String(entry.id ?? ''),
        mapCode: normalizeCode(entry.customName) || String(entry.id ?? ''),
        equipmentKind: classified.kind,
        centerXM: center.xM,
        centerYM: center.yM,
        bounds: getRefFieldBounds(entry.parameters),
      });
    }
  }

  return items;
}

/** facility id → 中心點座標（公尺，場域參照座標）。查不到回 null。 */
function resolveFacilityCenterById(mapId, facilityId) {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  const id = String(facilityId ?? '').trim();
  if (!id) return null;
  const items = loadFacilityGeometryFromMapFile(mapPath);
  const hit = items.find((item) => item.equipmentId === id || item.mapCode === id);
  if (!hit) return null;
  return { xM: hit.centerXM, yM: hit.centerYM };
}

/**
 * 座標 → 場區格位（矩形命中測試）。用來取代車端回報 yard_slot_id：
 * 車輛回報自己的 local_pose.position，中心端自行比對目前落在哪個格位範圍內。
 * 沒有命中（例如車輛在正線軌道上）回 null。
 */
function findFacilityAtPoint(mapId, xM, yM) {
  if (typeof xM !== 'number' || !Number.isFinite(xM)) return null;
  if (typeof yM !== 'number' || !Number.isFinite(yM)) return null;
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  const items = loadFacilityGeometryFromMapFile(mapPath);
  const hit = items.filter((item) => {
    if (!item.bounds) return false;
    return (
      xM >= item.bounds.xMinM && xM <= item.bounds.xMaxM
      && yM >= item.bounds.yMinM && yM <= item.bounds.yMaxM
    );
  }).sort((a, b) => {
    const area = (item) => (item.bounds.xMaxM - item.bounds.xMinM)
      * (item.bounds.yMaxM - item.bounds.yMinM);
    return area(a) - area(b);
  })[0];
  if (!hit) return null;
  return {
    mapCode: hit.mapCode,
    equipmentId: hit.equipmentId,
    equipmentKind: hit.equipmentKind,
  };
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const vehicleGeometryCache = new Map();

function loadVehicleLocationGeometry(mapId) {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  const stat = fs.statSync(mapPath);
  const cached = vehicleGeometryCache.get(mapId);
  if (cached?.path === mapPath && cached?.mtimeMs === stat.mtimeMs) return cached.geometry;

  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const geometry = { stations: [], facilities: [], tracks: [] };
  for (const area of Array.isArray(map.areas) ? map.areas : []) {
    for (const entry of Array.isArray(area.facilities) ? area.facilities : []) {
      const params = entry.parameters ?? {};
      if (entry.type === 'DockingPoint') {
        const xM = params.refFieldXM;
        const yM = params.refFieldYM;
        if (Number.isFinite(xM) && Number.isFinite(yM)) {
          geometry.stations.push({
            label: normalizeCode(entry.customName) || normalizeCode(params.stationName)
              || normalizeCode(params.stationId) || String(entry.id ?? ''),
            objectId: String(entry.id ?? ''),
            xM,
            yM,
          });
        }
        continue;
      }

      const classified = classifyMapObject(entry);
      if (classified?.category === OBJECT_CATEGORY.FACILITY) {
        const bounds = getRefFieldBounds(params);
        if (bounds) {
          geometry.facilities.push({
            label: normalizeCode(entry.customName) || String(entry.id ?? ''),
            objectId: String(entry.id ?? ''),
            bounds,
          });
        }
        continue;
      }

      if (entry.type === 'Track') {
        const rawPath = Array.isArray(params.trackGenRealPath) ? params.trackGenRealPath : [];
        const pathPoints = rawPath
          .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          .map((point) => ({ xM: Number(point[0]), yM: Number(point[1]) }));
        const bounds = getRefFieldBounds(params);
        geometry.tracks.push({
          label: normalizeCode(entry.customName) || normalizeCode(params.segmentId) || String(entry.id ?? ''),
          objectId: String(entry.id ?? ''),
          pathPoints,
          bounds,
        });
      }
    }
  }
  vehicleGeometryCache.set(mapId, { path: mapPath, mtimeMs: stat.mtimeMs, geometry });
  return geometry;
}

/** 車速達到這個值就不是「停在格位裡」（公尺／秒） */
const MOVING_MPS = 1.0;

/**
 * 車輛座標分類。顯示層級固定：停靠站點 → 場區設施 → 軌道段。
 * 站點以 8m 半徑判定；設施使用實際矩形；軌道取中心線最近距離。
 *
 * <h3>開著的車不算「在設施裡」</h3>
 * 設施（場區格位）的矩形跟軌道的中心線沒有互斥關係：本地圖資 M1 就被 T3 支線穿過，沿支線
 * 開的車座標會落在 M1 裡。車速 ≥ 1 m/s 時只當作在軌道上，設施命中要停著才算——跟圖台的
 * 場區判定同一條規則（見前端 yardClassification）。沒給車速就照舊。
 */
function findVehicleLocationAtPoint(mapId, xM, yM, options = {}) {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) return null;
  const geometry = loadVehicleLocationGeometry(mapId);
  if (!geometry) return null;

  let nearestStation = null;
  for (const station of geometry.stations) {
    const distanceM = Math.hypot(xM - station.xM, yM - station.yM);
    if (distanceM <= 8 && (!nearestStation || distanceM < nearestStation.distanceM)) {
      nearestStation = { ...station, distanceM };
    }
  }
  if (nearestStation) {
    return { kind: 'STATION', label: nearestStation.label, objectId: nearestStation.objectId };
  }

  const facility = geometry.facilities.filter(({ bounds }) => (
    xM >= bounds.xMinM && xM <= bounds.xMaxM
    && yM >= bounds.yMinM && yM <= bounds.yMaxM
  )).sort((a, b) => {
    const area = (item) => (item.bounds.xMaxM - item.bounds.xMinM)
      * (item.bounds.yMaxM - item.bounds.yMinM);
    return area(a) - area(b);
  })[0];
  const moving = Number.isFinite(options.speedMps) && Math.abs(options.speedMps) >= MOVING_MPS;
  if (facility && !moving) return { kind: 'FACILITY', label: facility.label, objectId: facility.objectId };

  let nearestTrack = null;
  for (const track of geometry.tracks) {
    let distanceM = Infinity;
    for (let index = 1; index < track.pathPoints.length; index += 1) {
      const a = track.pathPoints[index - 1];
      const b = track.pathPoints[index];
      distanceM = Math.min(distanceM, pointSegmentDistance(xM, yM, a.xM, a.yM, b.xM, b.yM));
    }
    if (!Number.isFinite(distanceM) && track.bounds
      && xM >= track.bounds.xMinM && xM <= track.bounds.xMaxM
      && yM >= track.bounds.yMinM && yM <= track.bounds.yMaxM) distanceM = 0;
    if (!nearestTrack || distanceM < nearestTrack.distanceM) nearestTrack = { ...track, distanceM };
  }
  if (nearestTrack && nearestTrack.distanceM <= 12) {
    return { kind: 'TRACK', label: nearestTrack.label, objectId: nearestTrack.objectId };
  }
  return null;
}

module.exports = {
  OBJECT_CATEGORY,
  EQUIPMENT_KIND,
  classifyMapObject,
  /** @deprecated 使用 classifyMapObject；保留相容舊呼叫 */
  classifyEquipmentKind(entry) {
    return classifyMapObject(entry)?.kind ?? EQUIPMENT_KIND.OTHER;
  },
  loadFieldEquipmentFromMapFile,
  loadFieldEquipment,
  getRefFieldBounds,
  facilityCenterMeters,
  loadFacilityGeometryFromMapFile,
  resolveFacilityCenterById,
  findFacilityAtPoint,
  findVehicleLocationAtPoint,
};
