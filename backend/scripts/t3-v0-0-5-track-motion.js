/**
 * T3 軌道合併加道路線 v0.1.10 場域範圍（MQTT / SQL 示範共用）
 *
 * 規則1（D 軌道）：N2W下行 → D01–D16 → T3下行 → D20–D33 → S2W下行（每站 36s）
 * 規則2（U 軌道）：S2W上行 → U35–U20 → T3上行 → U16–U03 → N2W上行（每站 36s）
 * 規則3：規則1 → 規則2 無限循環
 * 規則4（示範場景）：場上 4 台（PMS01～11 池輪替），間隔 3 分鐘 — 僅模擬器設定，非系統容量上限
 * 規則5：不跨軌道（D 走 D、U 走 U）；號誌前 20m 停等 5s
 */
const fs = require('fs');
const path = require('path');

const LEN = 50;
const W = 3.5;

const D_UPPER_Y_MIN = 100;
const D_UPPER_Y_MAX = 103.5;
const D_LOWER_Y_MIN = 303.5;
const D_LOWER_Y_MAX = 307;
const U_UPPER_Y_MIN = 103.5;
const U_UPPER_Y_MAX = 107;
const U_LOWER_Y_MIN = 300;
const U_LOWER_Y_MAX = 303.5;

const T3_D_X_MIN = 100;
const T3_D_X_MAX = 103.5;
const T3_U_X_MIN = 103.5;
const T3_U_X_MAX = 107;
const T3_D_Y_START = 103.5;
const T3_D_Y_END = 303.5;
const U_ROW_X_START = 103.5;
const U_ROW_X_FIRST_END = 150;

const D_UPPER_LANE_Y = (D_UPPER_Y_MIN + D_UPPER_Y_MAX) / 2;
const D_LOWER_LANE_Y = (D_LOWER_Y_MIN + D_LOWER_Y_MAX) / 2;
const U_UPPER_LANE_Y = (U_UPPER_Y_MIN + U_UPPER_Y_MAX) / 2;
const U_LOWER_LANE_Y = (U_LOWER_Y_MIN + U_LOWER_Y_MAX) / 2;

const VEHICLE_POOL = Array.from({ length: 11 }, (_, i) => `PMS${String(i + 1).padStart(2, '0')}`);
/** 場上四台示範車（0/3/6/9 分鐘發車） */
const ACTIVE_SLOT_VEHICLE_IDS = ['PMS01', 'PMS02', 'PMS08', 'PMS11'];
const ACTIVE_SLOT_COUNT = 4;
const SLOT_OFFSETS_MIN = [0, 3, 6, 9];
const BATTERY_DRAIN_PER_MIN = 3;
const BATTERY_CHARGE_PER_MIN = 10;
const BATTERY_RETIRE_THRESHOLD = 30;
const BATTERY_DEPLOY_LEVEL = 100;
const BATTERY_INITIAL_MIN = 70;
const BATTERY_INITIAL_MAX = 100;

const STAGGER_MS = 3 * 60 * 1000;

function domainWidthM(domain) {
  return Math.max(0.001, domain.xMaxM - domain.xMinM);
}

function domainHeightM(domain) {
  return Math.max(0.001, domain.yMaxM - domain.yMinM);
}

function areaLocalPxToMeter(xPx, yPx, domain, layout) {
  const pxPerMeterX = layout.wPx / domainWidthM(domain);
  const pxPerMeterY = layout.hPx / domainHeightM(domain);
  return {
    x: domain.xMinM + xPx / pxPerMeterX,
    y: domain.yMinM + yPx / pxPerMeterY,
  };
}

function getValidRefFieldBoundsFromParams(params) {
  const p = params ?? {};
  const xMinM = p.refFieldXMinM;
  const xMaxM = p.refFieldXMaxM;
  const yMinM = p.refFieldYMinM;
  const yMaxM = p.refFieldYMaxM;
  if (
    [xMinM, xMaxM, yMinM, yMaxM].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    xMaxM > xMinM &&
    yMaxM > yMinM
  ) {
    return { xMinM, xMaxM, yMinM, yMaxM };
  }
  return null;
}

function refFieldSubslotCenter(bounds, subIndex, capacity, options = {}) {
  if (capacity <= 1) {
    return {
      x: (bounds.xMinM + bounds.xMaxM) / 2,
      y: (bounds.yMinM + bounds.yMaxM) / 2,
    };
  }
  const w = bounds.xMaxM - bounds.xMinM;
  const h = bounds.yMaxM - bounds.yMinM;
  const splitAxis = options.splitAxis ?? 'auto';
  const splitAlongX = splitAxis === 'x' || (splitAxis === 'auto' && w >= h);
  if (splitAlongX) {
    const slice = w / capacity;
    return {
      x: bounds.xMinM + slice * (subIndex + 0.5),
      y: (bounds.yMinM + bounds.yMaxM) / 2,
    };
  }
  const slice = h / capacity;
  return {
    x: (bounds.xMinM + bounds.xMaxM) / 2,
    y: bounds.yMinM + slice * (subIndex + 0.5),
  };
}

const PARKING_SLOT_IDS = ['P1', 'P2', 'P3', 'P4'];

const YARD_MAINT_FACILITY_IDS = ['H1', 'H2', 'H3', 'M1', 'M2', 'M3', 'M4', 'W1'];

function facilityFieldCenterMeters(facility) {
  const params = facility.parameters ?? {};
  const bounds = getValidRefFieldBoundsFromParams(params);
  if (bounds) {
    return {
      x: (bounds.xMinM + bounds.xMaxM) / 2,
      y: (bounds.yMinM + bounds.yMaxM) / 2,
    };
  }
  const xM = params.refFieldXM;
  const yM = params.refFieldYM;
  if (typeof xM === 'number' && Number.isFinite(xM) && typeof yM === 'number' && Number.isFinite(yM)) {
    return { x: xM, y: yM };
  }
  return null;
}

function readFacilityRotationDeg(facility) {
  const deg = facility?.rotationDeg ?? facility?.rotation ?? 0;
  return typeof deg === 'number' && Number.isFinite(deg) ? deg : 0;
}

function loadParkingSlotsFromMap(facilitiesByName) {
  return PARKING_SLOT_IDS.map((id) => {
    const facility = facilitiesByName.get(id);
    const center = facility ? withHeading(facilityFieldCenterMeters(facility), facility) : null;
    if (!center) return null;
    return { id, x: center.x, y: center.y, ...(typeof center.heading === 'number' ? { heading: center.heading } : {}) };
  }).filter(Boolean);
}

function withHeading(center, facility) {
  return center
    ? {
        ...center,
        heading: (readFacilityRotationDeg(facility) * Math.PI) / 180,
      }
    : null;
}

const { resolveMapJsonPath } = require('./map-published-store');

const T3_MAIN_MAP_PATH =
  resolveMapJsonPath('t3-main-version')
  ?? path.join(__dirname, '../../frontend/public/maps/t3-main-version.json');

function buildYardSlotFallback() {
  /** 與 t3-main-version.json v0.1.10 refField 中心對齊（P1–P4 臨停格） */
  return {
    charging: [
      { id: 'E1', x: 715, y: 55, heading: 0 },
      { id: 'E2', x: 675, y: 55, heading: 0 },
      { id: 'E3', x: 635, y: 55, heading: 0 },
      { id: 'E4', x: 595, y: 55, heading: 0 },
    ],
    parking: [
      { id: 'P1', x: 1025, y: 101.75, heading: 0 },
      { id: 'P2', x: 1025, y: 105.25, heading: 0 },
      { id: 'P3', x: 1025, y: 301.75, heading: 0 },
      { id: 'P4', x: 1025, y: 305.25, heading: 0 },
    ],
    maint: [
      { id: 'H1', x: 185, y: 326.5, heading: 0 },
      { id: 'H2', x: 225, y: 325, heading: 0 },
      { id: 'H3', x: 265, y: 325, heading: 0 },
      { id: 'M1', x: 305, y: 325, heading: 0 },
      { id: 'M2', x: 345, y: 325, heading: 0 },
      { id: 'M3', x: 385, y: 325, heading: 0 },
      { id: 'M4', x: 425, y: 325, heading: 0 },
      { id: 'W1', x: 555, y: 55, heading: 0 },
    ],
  };
}

function loadYardSlotCatalog() {
  const fallback = buildYardSlotFallback();

  try {
    const mapPath = T3_MAIN_MAP_PATH;
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const facilitiesByName = new Map();
    for (const area of map.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        const name = typeof facility.customName === 'string' ? facility.customName.trim() : '';
        if (!name) continue;
        facilitiesByName.set(name, facility);
      }
    }
    const pickCenters = (ids, resolveCenter) =>
      ids
        .map((id) => {
          const center = resolveCenter(id);
          return center
            ? {
                id,
                x: center.x,
                y: center.y,
                ...(typeof center.heading === 'number' ? { heading: center.heading } : {}),
              }
            : null;
        })
        .filter(Boolean);
    const withHeading = (center, facility) =>
      center
        ? {
            ...center,
            heading: (readFacilityRotationDeg(facility) * Math.PI) / 180,
          }
        : null;
    const charging = pickCenters(['E1', 'E2', 'E3', 'E4'], (id) => {
      const facility = facilitiesByName.get(id);
      return facility ? withHeading(facilityFieldCenterMeters(facility), facility) : null;
    });
    const parking = loadParkingSlotsFromMap(facilitiesByName);
    const maint = pickCenters(YARD_MAINT_FACILITY_IDS, (id) => {
      const facility = facilitiesByName.get(id);
      return facility ? withHeading(facilityFieldCenterMeters(facility), facility) : null;
    });
    return {
      charging: charging.length === 4 ? charging : fallback.charging,
      parking: parking.length === 4 ? parking : fallback.parking,
      maint: maint.length === YARD_MAINT_FACILITY_IDS.length ? maint : fallback.maint,
    };
  } catch {
    return fallback;
  }
}

let yardSlotCatalogCache = null;
let yardSlotCatalogMtimeMs = 0;

function getYardSlotCatalog() {
  try {
    const stat = fs.statSync(T3_MAIN_MAP_PATH);
    if (!yardSlotCatalogCache || stat.mtimeMs !== yardSlotCatalogMtimeMs) {
      yardSlotCatalogCache = loadYardSlotCatalog();
      yardSlotCatalogMtimeMs = stat.mtimeMs;
    }
    return yardSlotCatalogCache;
  } catch {
    if (!yardSlotCatalogCache) {
      yardSlotCatalogCache = loadYardSlotCatalog();
    }
    return yardSlotCatalogCache;
  }
}

function yardCharging() {
  return getYardSlotCatalog().charging;
}

function yardParking() {
  return getYardSlotCatalog().parking;
}

function yardMaint() {
  return getYardSlotCatalog().maint;
}

/** @type {{ simStartMs: number, lastElapsedMs: number, slots: Array<{ slotIndex: number, offsetMin: number, vehicleId: string | null }>, vehicles: Record<string, { battery: number, status: 'on_field' | 'charging' | 'standby', timesDeployed: number, yardSlot: { kind: 'charge' | 'park' | 'maint', slotId: string, subIndex?: number } | null }> } | null} */
let fleetBatteryState = null;

function seededUnitRandom(simStartMs, salt) {
  const x = Math.sin(simStartMs * 0.00017 + salt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function initialBatteryForVehicle(simStartMs, vehicleId) {
  const salt = VEHICLE_POOL.indexOf(vehicleId);
  const unit = seededUnitRandom(simStartMs, salt >= 0 ? salt : 0);
  return BATTERY_INITIAL_MIN + unit * (BATTERY_INITIAL_MAX - BATTERY_INITIAL_MIN);
}

function resetFleetBatteryState(simStartMs) {
  const vehicles = {};
  for (const id of VEHICLE_POOL) {
    vehicles[id] = {
      battery: initialBatteryForVehicle(simStartMs, id),
      status: 'standby',
      timesDeployed: 0,
      yardSlot: null,
    };
  }
  const slots = SLOT_OFFSETS_MIN.map((offsetMin, slotIndex) => ({
    slotIndex,
    offsetMin,
    vehicleId: null,
  }));
  fleetBatteryState = {
    simStartMs,
    lastElapsedMs: 0,
    slots,
    vehicles,
  };
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    slots[slotIndex].vehicleId =
      ACTIVE_SLOT_VEHICLE_IDS[slotIndex] ?? VEHICLE_POOL[slotIndex];
  }
  rebalanceYardSlots();
  return fleetBatteryState;
}

function isDeployableVehicle(vehicleId) {
  const vehicle = fleetBatteryState?.vehicles?.[vehicleId];
  if (!vehicle || vehicle.status !== 'standby') return false;
  return vehicle.battery >= BATTERY_DEPLOY_LEVEL;
}

function findDeployableVehicle() {
  if (!fleetBatteryState) return null;
  const standby = VEHICLE_POOL.filter((id) => isDeployableVehicle(id));
  const fresh = standby.filter((id) => fleetBatteryState.vehicles[id].timesDeployed === 0);
  if (fresh.length > 0) return fresh[0];
  return standby[0] ?? null;
}

function deployVehicleToSlot(vehicleId) {
  const vehicle = fleetBatteryState.vehicles[vehicleId];
  vehicle.status = 'on_field';
  vehicle.timesDeployed += 1;
  vehicle.yardSlot = null;
}

function rebalanceYardSlots() {
  if (!fleetBatteryState) return;

  for (const id of VEHICLE_POOL) {
    const vehicle = fleetBatteryState.vehicles[id];
    if (vehicle.status === 'on_field') {
      vehicle.yardSlot = null;
      continue;
    }
    vehicle.yardSlot = null;
  }

  const chargingIds = [];
  for (const id of VEHICLE_POOL) {
    const vehicle = fleetBatteryState.vehicles[id];
    if (vehicle.status === 'on_field') continue;
    if (vehicle.status === 'standby' && vehicle.battery < BATTERY_DEPLOY_LEVEL) {
      vehicle.status = 'charging';
    }
    if (vehicle.status === 'charging') {
      chargingIds.push(id);
    }
  }

  let chargeIdx = 0;
  const chargingSorted = [...chargingIds].sort(
    (a, b) => VEHICLE_POOL.indexOf(a) - VEHICLE_POOL.indexOf(b),
  );
  for (const id of chargingSorted) {
    const vehicle = fleetBatteryState.vehicles[id];
    const chargingSlots = yardCharging();
    if (chargeIdx < chargingSlots.length) {
      vehicle.yardSlot = { kind: 'charge', slotId: chargingSlots[chargeIdx].id };
      chargeIdx += 1;
      continue;
    }
    const overflowIdx = chargeIdx - chargingSlots.length;
    const maintSlots = yardMaint();
    const maintSlot = maintSlots[overflowIdx % maintSlots.length];
    vehicle.yardSlot = { kind: 'maint', slotId: maintSlot.id };
    chargeIdx += 1;
  }

  const parkSlots = yardParking().map((slot) => slot.id);

  const standbyFull = VEHICLE_POOL.filter((id) => {
    const vehicle = fleetBatteryState.vehicles[id];
    return vehicle.status === 'standby' && vehicle.battery >= BATTERY_DEPLOY_LEVEL;
  });

  let parkIdx = 0;
  let maintIdx = 0;
  for (const id of standbyFull) {
    const vehicle = fleetBatteryState.vehicles[id];
    if (parkIdx < parkSlots.length) {
      vehicle.yardSlot = { kind: 'park', slotId: parkSlots[parkIdx] };
      parkIdx += 1;
      continue;
    }
    const maintSlots = yardMaint();
    const maintSlot = maintSlots[maintIdx % maintSlots.length];
    vehicle.yardSlot = { kind: 'maint', slotId: maintSlot.id };
    maintIdx += 1;
  }
}

function fillEmptySlots(elapsedMs, { immediate = false } = {}) {
  if (!fleetBatteryState) return;
  for (const slot of fleetBatteryState.slots) {
    if (slot.vehicleId) continue;
    if (!immediate) {
      const offsetMs = slot.offsetMin * 60 * 1000;
      if (elapsedMs < offsetMs) continue;
    }
    const replacement = findDeployableVehicle();
    if (!replacement) continue;
    deployVehicleToSlot(replacement);
    slot.vehicleId = replacement;
  }
}

function tickFleetBatteryState(elapsedMs, simStartMs) {
  if (!fleetBatteryState || fleetBatteryState.simStartMs !== simStartMs) {
    resetFleetBatteryState(simStartMs);
  }
  if (elapsedMs <= fleetBatteryState.lastElapsedMs) {
    return fleetBatteryState;
  }

  const deltaMs = elapsedMs - fleetBatteryState.lastElapsedMs;
  fleetBatteryState.lastElapsedMs = elapsedMs;
  const deltaMin = deltaMs / 60000;

  for (const slot of fleetBatteryState.slots) {
    if (!slot.vehicleId) continue;
    const scheduled = fleetBatteryState.vehicles[slot.vehicleId];
    if (!scheduled || scheduled.status === 'on_field') continue;
    const offsetMs = slot.offsetMin * 60 * 1000;
    if (elapsedMs >= offsetMs) {
      deployVehicleToSlot(slot.vehicleId);
    }
  }

  for (const slot of fleetBatteryState.slots) {
    if (!slot.vehicleId) continue;
    const vehicle = fleetBatteryState.vehicles[slot.vehicleId];
    if (vehicle.status !== 'on_field') continue;

    vehicle.battery = Math.max(0, vehicle.battery - BATTERY_DRAIN_PER_MIN * deltaMin);
    if (vehicle.battery > BATTERY_RETIRE_THRESHOLD) continue;

    vehicle.battery = BATTERY_RETIRE_THRESHOLD;
    vehicle.status = 'charging';
    vehicle.yardSlot = null;
    const replacement = findDeployableVehicle();
    if (replacement) {
      deployVehicleToSlot(replacement);
      slot.vehicleId = replacement;
    } else {
      slot.vehicleId = null;
    }
  }

  for (const id of VEHICLE_POOL) {
    const vehicle = fleetBatteryState.vehicles[id];
    if (vehicle.status !== 'charging') continue;
    vehicle.battery = Math.min(BATTERY_DEPLOY_LEVEL, vehicle.battery + BATTERY_CHARGE_PER_MIN * deltaMin);
    if (vehicle.battery < BATTERY_DEPLOY_LEVEL) continue;
    vehicle.battery = BATTERY_DEPLOY_LEVEL;
    vehicle.status = 'standby';
  }

  fillEmptySlots(elapsedMs);
  rebalanceYardSlots();
  return fleetBatteryState;
}

function getActiveFleet() {
  if (!fleetBatteryState) {
    return SLOT_OFFSETS_MIN.map((offsetMin, slotIndex) => ({
      id: ACTIVE_SLOT_VEHICLE_IDS[slotIndex] ?? VEHICLE_POOL[slotIndex],
      offsetMin,
      slotIndex,
    }));
  }
  return fleetBatteryState.slots
    .filter((slot) => slot.vehicleId)
    .map((slot) => ({
      id: slot.vehicleId,
      offsetMin: slot.offsetMin,
      slotIndex: slot.slotIndex,
    }));
}

function getVehicleBattery(vehicleId) {
  const vehicle = fleetBatteryState?.vehicles?.[vehicleId];
  if (!vehicle) return null;
  return Math.round(vehicle.battery * 10) / 10;
}

function getVehicleFleetStatus(vehicleId) {
  return fleetBatteryState?.vehicles?.[vehicleId]?.status ?? 'standby';
}

/** @deprecated 請改用 getActiveFleet()（須先 tickFleetBatteryState） */
function getFleet() {
  return getActiveFleet();
}

/** 每個停靠點總停站 36 秒 */
const DOCKING_DWELL_MS = 36 * 1000;
/** 進站後先停穩，再開月台門／車門 */
const STOP_SETTLE_MS = 1500;
/** 月台門與車門同步開啟（同時開始、同時完成） */
const DOOR_SYNC_OPEN_MS = 2000;
const PSD_CLOSE_MS = 1000;
const DOOR_CLOSE_MS = 2000;
/**
 * 停靠順序：停穩 → 月台門＋車門同步開 → 停留 → 車門關 → 月台門關
 */
const STATION_DWELL_MS =
  DOCKING_DWELL_MS - STOP_SETTLE_MS - DOOR_SYNC_OPEN_MS - PSD_CLOSE_MS - DOOR_CLOSE_MS;
/** @deprecated 與 DOOR_SYNC_OPEN_MS 相同，保留匯出相容 */
const PSD_OPEN_MS = DOOR_SYNC_OPEN_MS;
/** @deprecated 與 DOOR_SYNC_OPEN_MS 相同，保留匯出相容 */
const DOOR_OPEN_MS = DOOR_SYNC_OPEN_MS;
/** 四門依序開／關的時間差（毫秒） */
const DOOR_STAGGER_MS = 350;
const DOOR_OPEN_PERCENT_FIELDS = [
  'door_fl_open_percent',
  'door_fr_open_percent',
  'door_rl_open_percent',
  'door_rr_open_percent',
];
const DISPATCH_MS = 2500;
const INTER_STATION_TRAVEL_MS = 5000;
const VERTICAL_TRAVEL_MS = 60 * 1000;
/** 轉角後先橫移進直行柱（僅剩餘距離微調，不再長距離切到 junction） */
const COLUMN_ENTRY_MS = 2000;
const TURN_MS = 5000;
/** 轉彎後軸路徑尺度（公尺）；倍率 × 此值決定轉角出彎距離 */
const TURN_INNER_RADIUS_M = W * 0.55;
/** 後軸過進彎段 2/3 處即開始轉 heading（D16 西向約 x=133，不在段底硬轉） */
const TURN_START_SEGMENT_FRAC = 2 / 3;
const SIGNAL_WAIT_MS = 5000;
const SIGNAL_STOP_DISTANCE_M = 20;
const SIGNAL_AXIS_TOLERANCE_M = 1.5;

function dColumnCenterX() {
  return (T3_D_X_MIN + T3_D_X_MAX) / 2;
}

function uColumnCenterX() {
  return (T3_U_X_MIN + T3_U_X_MAX) / 2;
}
const MAX_STEER_RAD = Math.PI / 5;
const APPROACH_TURN_FRAC = 0.15;

/**
 * 場域 heading：順時針、東為 0°（0=E, 90=S, 180=W, 270°/−90°=N）
 */
const HEADING = {
  EAST: 0,
  SOUTH: Math.PI / 2,
  WEST: Math.PI,
  NORTH: -Math.PI / 2,
};

/** 停靠點站停（地圖 customName 如 N2W下行、S2W下行） */
const T3_DOCKING_STOPS_FALLBACK = {
  down: [
    { id: 'n2w-down', stationId: 'station_2', name: 'N2W下行', label: 'N2W下行', station: 'N2W', x: 840, y: 101.75, heading: HEADING.WEST },
    { id: 't3-down', stationId: 'station_3', name: 'T3下行', label: 'T3下行', station: 'T3', x: 101.75, y: 170, heading: HEADING.SOUTH },
    { id: 's2w-down', stationId: 'station_5', name: 'S2W下行', label: 'S2W下行', station: 'S2W', x: 810, y: 305.25, heading: HEADING.EAST },
  ],
  up: [
    { id: 's2w-up', stationId: 'station_6', name: 'S2W上行', label: 'S2W上行', station: 'S2W', x: 840, y: 301.75, heading: HEADING.WEST },
    { id: 't3-up', stationId: 'station_4', name: 'T3上行', label: 'T3上行', station: 'T3', x: 105, y: 230, heading: HEADING.NORTH },
    { id: 'n2w-up', stationId: 'station_1', name: 'N2W上行', label: 'N2W上行', station: 'N2W', x: 810, y: 105.25, heading: HEADING.EAST },
  ],
};

const MAINLINE_STATION_IDS_BY_LEG = {
  down: ['station_2', 'station_3', 'station_5'],
  up: ['station_6', 'station_4', 'station_1'],
};

function dockingSortKey(name) {
  if (name.includes('N2W')) return 0;
  if (name.includes('T3')) return 1;
  if (name.includes('S2W')) return 2;
  return 99;
}

const DOCKING_STATION_ORDER = { N2W: 0, T3: 1, S2W: 2 };

function dockingStationSortKey(station) {
  return DOCKING_STATION_ORDER[station] ?? 99;
}

function inferDockingHeading(name, leg) {
  if (name.includes('N2W')) return leg === 'down' ? HEADING.WEST : HEADING.EAST;
  if (name.includes('T3')) return leg === 'down' ? HEADING.SOUTH : HEADING.NORTH;
  if (name.includes('S2W')) return leg === 'down' ? HEADING.EAST : HEADING.WEST;
  return HEADING.EAST;
}

function inferDockingHeadingFromKeys(station, leg) {
  if (station === 'N2W') return leg === 'down' ? HEADING.WEST : HEADING.EAST;
  if (station === 'T3') return leg === 'down' ? HEADING.SOUTH : HEADING.NORTH;
  if (station === 'S2W') return leg === 'down' ? HEADING.EAST : HEADING.WEST;
  return HEADING.EAST;
}

function parseDockingLeg(raw) {
  if (raw === 'down' || raw === 'up') return raw;
  return null;
}

function parseDockingStation(raw) {
  if (raw === 'N2W' || raw === 'T3' || raw === 'S2W') return raw;
  return null;
}

function mergeDockingStops(parsed, fallback) {
  const out = { down: [], up: [] };
  for (const leg of ['down', 'up']) {
    for (const stationId of MAINLINE_STATION_IDS_BY_LEG[leg]) {
      const fromParsed = parsed[leg].find((s) => s.stationId === stationId);
      if (fromParsed) {
        out[leg].push(fromParsed);
        continue;
      }
      const fb = fallback[leg].find((s) => s.stationId === stationId);
      if (fb) out[leg].push({ ...fb });
    }
  }
  return out;
}

function inferStationFromLabel(label) {
  if (label.includes('N2W')) return 'N2W';
  if (label.includes('T3')) return 'T3';
  if (label.includes('S2W')) return 'S2W';
  return null;
}

function inferLegFromLabel(label) {
  if (label.includes('下行')) return 'down';
  if (label.includes('上行')) return 'up';
  return null;
}

function resolveDockingLabel(name, station, leg) {
  const trimmed = String(name || '').trim();
  if (trimmed && (trimmed.includes('上行') || trimmed.includes('下行'))) {
    return trimmed;
  }
  return `${station}${leg === 'down' ? '下行' : '上行'}`;
}

/** 地圖停靠點 → 月台門 entityId（T3 兩扇門 Y 相同，不可只靠最近距離） */
const KNOWN_PSD_BY_DOCKING_LABEL = {
  'N2W下行': 'Gate/141',
  'N2W上行': 'Gate/142',
  'T3下行': 'Gate/152',
  'T3上行': 'Gate/165',
  'S2W下行': 'Gate/150',
  'S2W上行': 'Gate/149',
};

function assignPsdsToDocks(mapDockingByArea, mapPsdByArea) {
  const psdByDockingLabel = {};
  const allPsdEntityIds = [];

  for (const psds of mapPsdByArea.values()) {
    for (const p of psds) allPsdEntityIds.push(p.entityId);
  }

  for (const [areaId, docks] of mapDockingByArea.entries()) {
    const psds = mapPsdByArea.get(areaId) || [];
    if (psds.length === 0) continue;

    const psdIdsInArea = new Set(psds.map((p) => p.entityId));
    for (const d of docks) {
      if (!d?.label) continue;
      const known = KNOWN_PSD_BY_DOCKING_LABEL[d.label];
      if (known && psdIdsInArea.has(known)) {
        psdByDockingLabel[d.label] = known;
      }
    }

    const pairs = [];
    for (const d of docks) {
      if (!d?.label || !d.positionMeters || psdByDockingLabel[d.label]) continue;
      for (const p of psds) {
        const dx = p.positionMeters.x - d.positionMeters.x;
        const dy = p.positionMeters.y - d.positionMeters.y;
        pairs.push({ label: d.label, entityId: p.entityId, dist: dx * dx + dy * dy });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    const usedDocks = new Set(Object.keys(psdByDockingLabel));
    const usedPsds = new Set(Object.values(psdByDockingLabel));
    for (const { label, entityId } of pairs) {
      if (usedDocks.has(label) || usedPsds.has(entityId)) continue;
      usedDocks.add(label);
      usedPsds.add(entityId);
      psdByDockingLabel[label] = entityId;
    }
  }

  return { psdByDockingLabel, allPsdEntityIds };
}

function parsePlannedRoutesFromMap(raw, byStationId) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const routeId = String(item.routeId ?? '').trim();
    const displayName = String(item.displayName ?? '').trim();
    const stationIds = Array.isArray(item.stationIds)
      ? item.stationIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!routeId || !displayName || stationIds.length < 2) continue;
    if (!stationIds.every((id) => byStationId[id])) continue;
    out.push({ routeId, displayName, stationIds });
  }
  return out;
}

function loadT3DockingStops() {
  const parsed = { down: [], up: [] };
  const byLabel = {};
  const byStationId = {};
  const mapDockingByArea = new Map(); // areaId -> docking entries (with positionMeters)
  const mapPsdByArea = new Map(); // areaId -> psd entries
  try {
    const mapPath = T3_MAIN_MAP_PATH;
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    for (const area of map.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        if (facility.type !== 'DockingPoint') continue;
        const params = facility.parameters ?? {};
        const x = params.refFieldXM;
        const y = params.refFieldYM;
        if (typeof x !== 'number' || typeof y !== 'number') continue;

        let station = parseDockingStation(params.dockingStation);
        const stationId = String(params.stationId ?? '').trim();
        const name = String(params.stationName || facility.customName || '').trim();
        /** 僅由站點名稱推斷上下行語意（demo 用）；不再讀 dockingLeg */
        let leg = inferLegFromLabel(name);
        if (!leg && name.includes('下行')) leg = 'down';
        if (!leg && name.includes('上行')) leg = 'up';
        if (!station && name.includes('N2W')) station = 'N2W';
        if (!station && name.includes('T3')) station = 'T3';
        if (!station && name.includes('S2W')) station = 'S2W';

        if (!leg || (!stationId && !station)) continue;

        const label = resolveDockingLabel(name, station, leg);
        const labelLeg = inferLegFromLabel(label) ?? leg;
        const labelStation = inferStationFromLabel(label) ?? station;

        const entry = {
          id: String(facility.id),
          stationId: stationId || undefined,
          name: name || label,
          label,
          station: labelStation,
          x,
          y,
          heading: inferDockingHeadingFromKeys(labelStation, labelLeg),
          positionMeters:
            facility.positionMeters &&
            typeof facility.positionMeters.x === 'number' &&
            typeof facility.positionMeters.y === 'number'
              ? { x: facility.positionMeters.x, y: facility.positionMeters.y }
              : null,
          areaId: String(area.id),
        };
        parsed[labelLeg].push(entry);
        byLabel[label] = entry;
        if (stationId) byStationId[stationId] = entry;

        if (!mapDockingByArea.has(entry.areaId)) mapDockingByArea.set(entry.areaId, []);
        mapDockingByArea.get(entry.areaId).push(entry);
      }
    }

    // Collect PSDs (platform doors) for label→psd mapping
    for (const area of map.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        if (facility.type !== 'PSD') continue;
        const pm = facility.positionMeters;
        if (!pm || typeof pm.x !== 'number' || typeof pm.y !== 'number') continue;
        const id = String(facility.parameters?.mqttInstanceId || facility.id);
        const entityId = `Gate/${id}`;
        const psd = { id, entityId, positionMeters: { x: pm.x, y: pm.y }, areaId: String(area.id) };
        if (!mapPsdByArea.has(psd.areaId)) mapPsdByArea.set(psd.areaId, []);
        mapPsdByArea.get(psd.areaId).push(psd);
      }
    }
    parsed.down.sort(
      (a, b) =>
        MAINLINE_STATION_IDS_BY_LEG.down.indexOf(a.stationId)
        - MAINLINE_STATION_IDS_BY_LEG.down.indexOf(b.stationId),
    );
    parsed.up.sort(
      (a, b) =>
        MAINLINE_STATION_IDS_BY_LEG.up.indexOf(a.stationId)
        - MAINLINE_STATION_IDS_BY_LEG.up.indexOf(b.stationId),
    );
    if (parsed.down.length > 0 || parsed.up.length > 0) {
      const merged = mergeDockingStops(parsed, T3_DOCKING_STOPS_FALLBACK);
      for (const leg of ['down', 'up']) {
        for (const stop of merged[leg]) {
          if (!stop.label) {
            stop.label = resolveDockingLabel(stop.name, stop.station, leg);
          }
          if (!byLabel[stop.label]) {
            byLabel[stop.label] = stop;
          }
        }
      }
      merged.byLabel = byLabel;
      merged.byStationId = byStationId;
      merged.plannedRoutes = parsePlannedRoutesFromMap(map.routes, byStationId);
      merged.mapVersion = map.version ?? null;
      merged.mapUpdatedAt = map.updatedAt ?? null;
      merged.mapPath = mapPath;
      const psdMap = assignPsdsToDocks(mapDockingByArea, mapPsdByArea);
      merged.psdByDockingLabel = psdMap.psdByDockingLabel;
      merged.allPsdEntityIds = psdMap.allPsdEntityIds;
      return merged;
    }
  } catch {
    /* use fallback */
  }
  const fallback = { ...T3_DOCKING_STOPS_FALLBACK, byLabel: {}, byStationId: {}, plannedRoutes: [] };
  for (const leg of ['down', 'up']) {
    for (const stop of fallback[leg]) {
      fallback.byLabel[stop.label] = { ...stop, station: inferStationFromLabel(stop.label) ?? stop.station };
      if (stop.stationId) fallback.byStationId[stop.stationId] = fallback.byLabel[stop.label];
    }
  }
  fallback.psdByDockingLabel = { ...KNOWN_PSD_BY_DOCKING_LABEL };
  fallback.allPsdEntityIds = Object.values(KNOWN_PSD_BY_DOCKING_LABEL);
  return fallback;
}

const T3_DOCKING_STOPS = loadT3DockingStops();

const DOCKING_STOP_LABELS = [
  'N2W下行',
  'T3下行',
  'S2W下行',
  'S2W上行',
  'T3上行',
  'N2W上行',
];

const DOCKING_TRACK_FAMILY = {
  'N2W下行': 'D',
  'T3下行': 'D',
  'S2W下行': 'D',
  'S2W上行': 'U',
  'T3上行': 'U',
  'N2W上行': 'U',
};

function resolveDockStop(label) {
  const raw = getDockingStopByLabel(label);
  const family = DOCKING_TRACK_FAMILY[label] ?? 'D';
  const stop = dockOnTrackFamily(raw, family);
  return { label, raw, stop, family };
}

/** 模擬器啟動時列印：內建地图版本與各停靠點 refField → 停站座標 */
function printDockingStopsAudit() {
  const ver = T3_DOCKING_STOPS.mapVersion ?? 'fallback';
  const at = T3_DOCKING_STOPS.mapUpdatedAt ?? '';
  console.log(
    `[t3-motion] 停靠點來源 ${path.basename(T3_MAIN_MAP_PATH)} ${ver}${at ? ` (${at})` : ''}`,
  );
  for (const label of DOCKING_STOP_LABELS) {
    const { raw, stop, family } = resolveDockStop(label);
    const deg = ((stop.heading * 180) / Math.PI).toFixed(0);
    console.log(
      `  ${label}: refField (${raw.x}, ${raw.y}) → 停站 (${stop.x}, ${stop.y}) [${family}軌] heading=${deg}°`,
    );
  }
  const planned = T3_DOCKING_STOPS.plannedRoutes ?? [];
  if (planned.length > 0) {
    console.log(`[t3-motion] 地圖路線清單 ${planned.length} 條（模擬將依此站序行進）`);
    for (const route of planned) {
      console.log(`  ${route.displayName} (${route.routeId}): ${route.stationIds.join(' → ')}`);
    }
  } else {
    console.log('[t3-motion] 地圖尚無 routes[] 路線清單，使用預設 D/U 正線軌跡');
  }
}

function getDockingStopByLabel(label) {
  const hit = T3_DOCKING_STOPS.byLabel?.[label];
  if (hit) return hit;
  for (const leg of ['down', 'up']) {
    const found = T3_DOCKING_STOPS[leg].find((s) => s.label === label);
    if (found) return found;
  }
  const station = inferStationFromLabel(label);
  const leg = inferLegFromLabel(label);
  if (station && leg) return getDockingStop(leg, station);
  throw new Error(`Missing docking stop label ${label}`);
}

function getDockingStop(leg, station) {
  const hit = T3_DOCKING_STOPS[leg].find((s) => s.station === station);
  if (hit) return hit;
  const fb = T3_DOCKING_STOPS_FALLBACK[leg].find((s) => {
    if (station === 'N2W') return s.id.includes('n2w');
    if (station === 'T3') return s.id.includes('t3');
    return s.id.includes('s2w');
  });
  if (!fb) throw new Error(`Missing docking stop ${leg}/${station}`);
  return { ...fb, station };
}

/** 單 leg（D02→D34 或 U34→U02）目標時長 */
const TARGET_LEG_DURATION_MS = 6 * 60 * 1000;

/** v0.1.4 圖台：各路徑接近號誌時的車頭朝向（與 HEADING 常數一致） */
const SIGNAL_APPROACHES_BY_ID = {
  S01: [HEADING.WEST],
  S02: [HEADING.SOUTH, HEADING.NORTH],
  S03: [HEADING.EAST],
  S04: [HEADING.EAST],
  S05: [HEADING.WEST],
  S06: [HEADING.WEST],
  S07: [HEADING.EAST],
};

const SIGNAL_LANE_Y = [D_UPPER_LANE_Y, U_UPPER_LANE_Y, D_LOWER_LANE_Y, U_LOWER_LANE_Y];

function snapLaneY(yM) {
  let best = SIGNAL_LANE_Y[0];
  let bestDist = Math.abs(yM - best);
  for (let i = 1; i < SIGNAL_LANE_Y.length; i += 1) {
    const dist = Math.abs(yM - SIGNAL_LANE_Y[i]);
    if (dist < bestDist) {
      best = SIGNAL_LANE_Y[i];
      bestDist = dist;
    }
  }
  return best;
}

function snapLaneX(xM) {
  const lanes = [dColumnCenterX(), uColumnCenterX()];
  let best = lanes[0];
  let bestDist = Math.abs(xM - best);
  for (let i = 1; i < lanes.length; i += 1) {
    const dist = Math.abs(xM - lanes[i]);
    if (dist < bestDist) {
      best = lanes[i];
      bestDist = dist;
    }
  }
  return best;
}

function signalEntityId(facility) {
  const tail = String(facility.parameters?.mqttInstanceId || facility.id).trim();
  return `Light/${tail}`;
}

function buildSignalStopEntry(id, x, y, approach, entityId) {
  const horizontal = approach === HEADING.EAST || approach === HEADING.WEST;
  return {
    id,
    x,
    y,
    approach,
    guardX: horizontal ? x : snapLaneX(x),
    guardY: horizontal ? snapLaneY(y) : y,
    entityId,
  };
}

const T3_SIGNAL_STOPS_FALLBACK = [
  buildSignalStopEntry('S01', 770, 98, HEADING.WEST, 'Light/161'),
  buildSignalStopEntry('S07', 760, 108.25, HEADING.EAST, 'Light/180'),
  buildSignalStopEntry('S06', 175, 108.25, HEADING.WEST, 'Light/160'),
  buildSignalStopEntry('S02', 98, 135, HEADING.SOUTH, 'Light/067'),
  buildSignalStopEntry('S02', 98, 135, HEADING.NORTH, 'Light/067'),
  buildSignalStopEntry('S03', 125, 308.5, HEADING.EAST, 'Light/181'),
  buildSignalStopEntry('S05', 150, 298, HEADING.WEST, 'Light/107'),
  buildSignalStopEntry('S04', 750, 308.5, HEADING.EAST, 'Light/182'),
];

function loadT3SignalsFromMap() {
  try {
    const mapPath = T3_MAIN_MAP_PATH;
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const stops = [];
    const registryByEntity = new Map();
    for (const area of map.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        if (facility.type !== 'Signal') continue;
        const params = facility.parameters ?? {};
        const id = String(facility.customName || params.signalId || '').trim();
        const approaches = SIGNAL_APPROACHES_BY_ID[id];
        if (!id || !approaches?.length) continue;
        if (typeof params.refFieldXM !== 'number' || typeof params.refFieldYM !== 'number') continue;
        const entityId = signalEntityId(facility);
        if (!registryByEntity.has(entityId)) {
          registryByEntity.set(entityId, {
            id,
            x: params.refFieldXM,
            y: params.refFieldYM,
            entityId,
          });
        }
        for (const approach of approaches) {
          stops.push(
            buildSignalStopEntry(id, params.refFieldXM, params.refFieldYM, approach, entityId),
          );
        }
      }
    }
    if (stops.length === 0) return null;
    return { stops, registry: [...registryByEntity.values()] };
  } catch {
    return null;
  }
}

function loadT3SignalStops() {
  const loaded = loadT3SignalsFromMap();
  return loaded?.stops?.length ? loaded.stops : T3_SIGNAL_STOPS_FALLBACK;
}

function loadT3SignalRegistry() {
  const loaded = loadT3SignalsFromMap();
  if (loaded?.registry?.length) return loaded.registry;
  const byEntity = new Map();
  for (const stop of T3_SIGNAL_STOPS_FALLBACK) {
    if (!byEntity.has(stop.entityId)) {
      byEntity.set(stop.entityId, {
        id: stop.id,
        x: stop.x,
        y: stop.y,
        entityId: stop.entityId,
      });
    }
  }
  return [...byEntity.values()];
}

const T3_SIGNAL_STOPS = loadT3SignalStops();
const T3_SIGNAL_REGISTRY = loadT3SignalRegistry();

function stopPointBeforeSignal(signalX, signalY, approachHeading, travelAxisM, distanceM = SIGNAL_STOP_DISTANCE_M) {
  /** 停等點須落在行進軸上（橫移用 travel Y，縱移用 travel X），不可用號誌 Y/X 避免切斜線偏離軌道 */
  if (approachHeading === HEADING.EAST) return { x: signalX - distanceM, y: travelAxisM };
  if (approachHeading === HEADING.WEST) return { x: signalX + distanceM, y: travelAxisM };
  if (approachHeading === HEADING.SOUTH) return { x: travelAxisM, y: signalY - distanceM };
  if (approachHeading === HEADING.NORTH) return { x: travelAxisM, y: signalY + distanceM };
  return { x: signalX, y: signalY };
}

/** 橫向行駛時，號誌 refField 須與車輛所在軌道列一致（±1.5m） */
function signalGuardsHorizontalRow(signalY, travelY) {
  return Math.abs(signalY - travelY) <= SIGNAL_AXIS_TOLERANCE_M;
}

/** 縱向行駛時，號誌 refField 須與車輛所在直行柱一致（±1.5m） */
function signalGuardsVerticalColumn(signalX, travelX) {
  return Math.abs(signalX - travelX) <= SIGNAL_AXIS_TOLERANCE_M;
}

function signalsOnTravelSegment(x0, y0, x1, y1, heading) {
  const hits = [];
  const travelAxisM = heading === HEADING.WEST || heading === HEADING.EAST ? y0 : x0;

  for (const signal of T3_SIGNAL_STOPS) {
    if (signal.approach !== heading) continue;

    if (heading === HEADING.WEST || heading === HEADING.EAST) {
      const guardY = signal.guardY ?? snapLaneY(signal.y);
      if (!signalGuardsHorizontalRow(guardY, travelAxisM)) continue;
    } else {
      const guardX = signal.guardX ?? snapLaneX(signal.x);
      if (!signalGuardsVerticalColumn(guardX, travelAxisM)) continue;
    }

    const stop = stopPointBeforeSignal(
      signal.x,
      signal.y,
      heading,
      travelAxisM,
    );

    if (heading === HEADING.WEST || heading === HEADING.EAST) {
      if (Math.abs(stop.y - y0) > SIGNAL_AXIS_TOLERANCE_M) continue;
      if (heading === HEADING.WEST && !(x0 >= stop.x && stop.x >= x1)) continue;
      if (heading === HEADING.EAST && !(x0 <= stop.x && stop.x <= x1)) continue;
      hits.push({ ...signal, stopX: stop.x, stopY: stop.y, sortKey: stop.x });
      continue;
    }
    if (heading === HEADING.SOUTH || heading === HEADING.NORTH) {
      if (Math.abs(stop.x - x0) > SIGNAL_AXIS_TOLERANCE_M) continue;
      if (heading === HEADING.SOUTH && !(y0 <= stop.y && stop.y <= y1)) continue;
      if (heading === HEADING.NORTH && !(y0 >= stop.y && stop.y >= y1)) continue;
      hits.push({ ...signal, stopX: stop.x, stopY: stop.y, sortKey: stop.y });
    }
  }
  if (heading === HEADING.WEST) hits.sort((a, b) => b.sortKey - a.sortKey);
  if (heading === HEADING.EAST) hits.sort((a, b) => a.sortKey - b.sortKey);
  if (heading === HEADING.SOUTH) hits.sort((a, b) => a.sortKey - b.sortKey);
  if (heading === HEADING.NORTH) hits.sort((a, b) => b.sortKey - a.sortKey);
  return hits;
}

function appendTravelWithSignalStops(timeline, x0, y0, x1, y1, heading, durationMs, options = {}) {
  const hits = signalsOnTravelSegment(x0, y0, x1, y1, heading);
  const totalDist = Math.hypot(x1 - x0, y1 - y0);
  if (hits.length === 0 || totalDist < 1) {
    timeline.push(travelEvent(x0, y0, x1, y1, heading, durationMs, options));
    return;
  }

  let cx = x0;
  let cy = y0;
  const seenStops = new Set();
  for (const hit of hits) {
    const stopKey = `${hit.stopX.toFixed(2)}|${hit.stopY.toFixed(2)}`;
    if (seenStops.has(stopKey)) continue;
    seenStops.add(stopKey);

    const distToEnd = Math.hypot(x1 - hit.stopX, y1 - hit.stopY);
    if (distToEnd < 5) continue;

    const legDist = Math.hypot(hit.stopX - cx, hit.stopY - cy);
    if (legDist > 0.5) {
      const legMs = Math.max(400, Math.round(durationMs * (legDist / totalDist)));
      timeline.push(travelEvent(cx, cy, hit.stopX, hit.stopY, heading, legMs));
    }
    timeline.push(
      signalWaitEvent({
        x: hit.stopX,
        y: hit.stopY,
        heading,
        track: classifyT3FieldTrack(hit.stopX, hit.stopY),
        signalId: hit.id,
      }),
    );
    cx = hit.stopX;
    cy = hit.stopY;
  }

  const remainDist = Math.hypot(x1 - cx, y1 - cy);
  if (remainDist > 0.5) {
    const remainMs = Math.max(400, Math.round(durationMs * (remainDist / totalDist)));
    timeline.push(travelEvent(cx, cy, x1, y1, heading, remainMs, options));
  }
}

function uUpperXBounds(n) {
  if (n === 16) return { xMin: U_ROW_X_START, xMax: U_ROW_X_FIRST_END };
  const xMin = U_ROW_X_FIRST_END + (15 - n) * LEN;
  return { xMin, xMax: xMin + LEN };
}

function uLowerXBounds(n) {
  if (n === 20) return { xMin: U_ROW_X_START, xMax: U_ROW_X_FIRST_END };
  const xMin = U_ROW_X_FIRST_END + (n - 21) * LEN;
  return { xMin, xMax: xMin + LEN };
}

/** @type {Record<string, { xMinM: number, xMaxM: number, yMinM: number, yMaxM: number }>} */
const TRACK = {};

function h(xMin, yMin, xMax = xMin + LEN, yMax = yMin + W) {
  return { xMinM: xMin, xMaxM: xMax, yMinM: yMin, yMaxM: yMax };
}
function v(xMin, yMin, yMax, xMax = xMin + W) {
  return { xMinM: xMin, xMaxM: xMax, yMinM: yMin, yMaxM: yMax };
}
function dTrack(n) {
  return `D${String(n).padStart(2, '0')}`;
}
function uTrack(n) {
  return `U${String(n).padStart(2, '0')}`;
}

for (let n = 1; n <= 16; n++) {
  const xMax = 900 - (n - 1) * LEN;
  TRACK[dTrack(n)] = h(xMax - LEN, D_UPPER_Y_MIN, xMax, D_UPPER_Y_MAX);
}
TRACK.U16 = h(U_ROW_X_START, U_UPPER_Y_MIN, U_ROW_X_FIRST_END, U_UPPER_Y_MAX);
for (let n = 1; n <= 15; n++) {
  const xMin = U_ROW_X_FIRST_END + (15 - n) * LEN;
  TRACK[uTrack(n)] = h(xMin, U_UPPER_Y_MIN, xMin + LEN, U_UPPER_Y_MAX);
}
TRACK.U20 = h(U_ROW_X_START, U_LOWER_Y_MIN, U_ROW_X_FIRST_END, U_LOWER_Y_MAX);
for (let n = 21; n <= 35; n++) {
  const xMin = U_ROW_X_FIRST_END + (n - 21) * LEN;
  TRACK[uTrack(n)] = h(xMin, U_LOWER_Y_MIN, xMin + LEN, U_LOWER_Y_MAX);
}
for (let n = 20; n <= 35; n++) {
  const xMin = 100 + (n - 20) * LEN;
  TRACK[dTrack(n)] = h(xMin, D_LOWER_Y_MIN, xMin + LEN, D_LOWER_Y_MAX);
}
TRACK.D17 = v(T3_D_X_MIN, 103.5, 150, T3_D_X_MAX);
TRACK.D18 = v(T3_D_X_MIN, 150, 250, T3_D_X_MAX);
TRACK.D19 = v(T3_D_X_MIN, 250, T3_D_Y_END, T3_D_X_MAX);
TRACK.U17 = v(T3_U_X_MIN, 107, 150, T3_U_X_MAX);
TRACK.U18 = v(T3_U_X_MIN, 150, 250, T3_U_X_MAX);
TRACK.U19 = v(T3_U_X_MIN, 250, 300, T3_U_X_MAX);

function normalizeTrackCode(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().toUpperCase();
  const match = trimmed.match(/^([DUTR])(\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}${String(Number(match[2])).padStart(2, '0')}`;
}

/** 自 t3-main-version 載入 refField；segment_label 與前端 locate 一致 */
function loadMapRefFieldSegments() {
  try {
    const mapPath = T3_MAIN_MAP_PATH;
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const segments = [];
    for (const area of map.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        if (facility.type !== 'Track') continue;
        const params = facility.parameters ?? {};
        const xMinM = params.refFieldXMinM;
        const xMaxM = params.refFieldXMaxM;
        const yMinM = params.refFieldYMinM;
        const yMaxM = params.refFieldYMaxM;
        if (
          [xMinM, xMaxM, yMinM, yMaxM].some((v) => typeof v !== 'number' || !Number.isFinite(v))
        ) {
          continue;
        }
        if (xMaxM <= xMinM || yMaxM <= yMinM) continue;
        const trackCode =
          normalizeTrackCode(facility.customName) ||
          normalizeTrackCode(params.segmentId);
        const segmentAlias = normalizeTrackCode(params.segmentId);
        segments.push({
          trackId: facility.id,
          trackCode,
          bounds: { xMinM, xMaxM, yMinM, yMaxM },
        });
        if (trackCode) {
          TRACK[trackCode] = { xMinM, xMaxM, yMinM, yMaxM };
          if (segmentAlias && segmentAlias !== trackCode) {
            TRACK[segmentAlias] = { xMinM, xMaxM, yMinM, yMaxM };
          }
        }
      }
    }
    return segments;
  } catch {
    return [];
  }
}

const MAP_REF_FIELD_SEGMENTS = loadMapRefFieldSegments();

function inHalfOpen(value, min, max) {
  return value > min && value < max;
}

function nearBoundary(value, boundary) {
  return Math.abs(value - boundary) <= 1e-6;
}

const D_U_JUNCTION_MARGIN = 1.0;

function classifyDUpperCornerTransition(xM, yM) {
  if (yM <= D_UPPER_Y_MAX || yM > D_UPPER_Y_MAX + D_U_JUNCTION_MARGIN) return null;
  if (xM <= T3_D_X_MAX) return null;
  return classifyDUpperRow(xM);
}

function classifyDUpperRow(xM) {
  for (let n = 1; n <= 16; n++) {
    const xMax = 900 - (n - 1) * LEN;
    const xMin = xMax - LEN;
    if (inHalfOpen(xM, xMin, xMax)) return dTrack(n);
  }
  return null;
}

function classifyDLowerRow(xM) {
  for (let n = 20; n <= 35; n++) {
    const xMin = 100 + (n - 20) * LEN;
    if (inHalfOpen(xM, xMin, xMin + LEN)) return dTrack(n);
  }
  return null;
}

function classifyUUpperRow(xM) {
  for (let n = 1; n <= 16; n++) {
    const { xMin, xMax } = uUpperXBounds(n);
    if (inHalfOpen(xM, xMin, xMax)) return uTrack(n);
  }
  return null;
}

function classifyULowerRow(xM) {
  for (let n = 20; n <= 35; n++) {
    const { xMin, xMax } = uLowerXBounds(n);
    if (inHalfOpen(xM, xMin, xMax)) return uTrack(n);
  }
  return null;
}

function classifyT3DColumn(yM) {
  if (inHalfOpen(yM, 103.5, 150)) return 'D17';
  if (inHalfOpen(yM, 150, 250)) return 'D18';
  if (inHalfOpen(yM, 250, T3_D_Y_END)) return 'D19';
  if (nearBoundary(yM, 150)) return 'D18';
  if (nearBoundary(yM, 250)) return 'D19';
  return null;
}

function classifyT3UColumn(yM) {
  if (inHalfOpen(yM, 107, 150)) return 'U17';
  if (inHalfOpen(yM, 150, 250)) return 'U18';
  if (inHalfOpen(yM, 250, 300)) return 'U19';
  if (nearBoundary(yM, 150)) return 'U18';
  if (nearBoundary(yM, 250)) return 'U19';
  return null;
}

/** 巢狀開區間判定軌道代碼 */
function classifyT3FieldTrack(xM, yM) {
  if (!Number.isFinite(xM) || !Number.isFinite(yM)) return null;

  if (inHalfOpen(xM, T3_D_X_MIN, T3_D_X_MAX)) {
    if (inHalfOpen(yM, T3_D_Y_START, T3_D_Y_END)) {
      return classifyT3DColumn(yM);
    }
    if (nearBoundary(yM, T3_D_Y_START)) {
      return 'D17';
    }
    if (nearBoundary(yM, T3_D_Y_END)) {
      return 'D19';
    }
  }

  if (inHalfOpen(xM, T3_U_X_MIN, T3_U_X_MAX)) {
    if (inHalfOpen(yM, 107, 300)) {
      return classifyT3UColumn(yM);
    }
    if (nearBoundary(yM, 107)) {
      return 'U17';
    }
    if (nearBoundary(yM, 300)) {
      return 'U19';
    }
  }

  if (inHalfOpen(yM, D_UPPER_Y_MIN, D_UPPER_Y_MAX)) {
    return classifyDUpperRow(xM);
  }

  if (nearBoundary(yM, D_UPPER_Y_MAX) && xM > T3_D_X_MAX) {
    const row = classifyDUpperRow(xM);
    if (row) return row;
  }

  const cornerD = classifyDUpperCornerTransition(xM, yM);
  if (cornerD) return cornerD;

  if (inHalfOpen(yM, U_UPPER_Y_MIN, U_UPPER_Y_MAX)) {
    return classifyUUpperRow(xM);
  }

  if (inHalfOpen(yM, U_LOWER_Y_MIN, U_LOWER_Y_MAX)) {
    return classifyULowerRow(xM);
  }

  if (inHalfOpen(yM, D_LOWER_Y_MIN, D_LOWER_Y_MAX)) {
    return classifyDLowerRow(xM);
  }

  return null;
}

function trackCodeFromSegmentLabel(segmentLabel) {
  if (!segmentLabel || typeof segmentLabel !== 'string') return null;
  const label = segmentLabel.trim();
  if (!label) return null;
  if (label.includes('→')) {
    const parts = label.split('→').map((s) => s.trim());
    const toPart = parts[parts.length - 1];
    if (/^(D|U)\d{1,2}$/i.test(toPart)) {
      return toPart.toUpperCase().replace(/^([DU])(\d+)$/, (_, p, n) => `${p}${String(Number(n)).padStart(2, '0')}`);
    }
    const fromPart = parts[0];
    if (/^(D|U)\d{1,2}$/i.test(fromPart)) {
      return fromPart.toUpperCase().replace(/^([DU])(\d+)$/, (_, p, n) => `${p}${String(Number(n)).padStart(2, '0')}`);
    }
    return null;
  }
  if (/^(D|U)\d{1,2}$/i.test(label)) {
    return label.toUpperCase().replace(/^([DU])(\d+)$/, (_, p, n) => `${p}${String(Number(n)).padStart(2, '0')}`);
  }
  return null;
}

function resolveT3TrackCode(xM, yM, _segmentLabel) {
  return classifyT3FieldTrack(xM, yM);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function shortestAngleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

function lerpAngleSweep(from, sweepRad, t) {
  return from + sweepRad * clamp01(t);
}

function steerSignForSweep(sweepRad) {
  if (Math.abs(sweepRad) < 1e-6) return 0;
  return sweepRad > 0 ? 1 : -1;
}

function headingCardinalLabel(h) {
  const eps = 0.05;
  if (Math.abs(h) < eps || Math.abs(h - 2 * Math.PI) < eps) return 'E';
  if (Math.abs(h - HEADING.SOUTH) < eps) return 'S';
  if (Math.abs(h - HEADING.WEST) < eps || Math.abs(h + HEADING.WEST) < eps) return 'W';
  if (Math.abs(h - HEADING.NORTH) < eps) return 'N';
  return null;
}

/**
 * 90° 轉角：進彎段 2/3 起點 → 出彎段（如 D17）橫向中心 + 沿出彎方向進入。
 */
const TURN_EXIT_TRACK = {
  'W-S': 'D17',
  'S-E': 'D20',
  'W-N': 'U17',
  'N-E': 'U16',
};
/** 沿出彎段進入深度（W-S：D17 南向） */
const TURN_EXIT_SEGMENT_FRAC = 0.22;
/** 轉彎：先對齊出彎軸（x 或 y），再沿另一軸深入，避免斜切到相鄰軌道 */
const TURN_AXIS_SECOND_DELAY = 0.42;

function smoothstep01(t) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function sampleTurnAxisPath(start, end, te, primaryAxis) {
  const delay = TURN_AXIS_SECOND_DELAY;
  if (primaryAxis === 'x') {
    const xT = Math.min(1, te / delay);
    const yT = te <= delay ? 0 : (te - delay) / (1 - delay);
    return {
      x: start.x + (end.x - start.x) * smoothstep01(xT),
      y: start.y + (end.y - start.y) * smoothstep01(yT),
    };
  }
  if (primaryAxis === 'y') {
    const yT = Math.min(1, te / delay);
    const xT = te <= delay ? 0 : (te - delay) / (1 - delay);
    return {
      x: start.x + (end.x - start.x) * smoothstep01(xT),
      y: start.y + (end.y - start.y) * smoothstep01(yT),
    };
  }
  return { x: end.x, y: end.y };
}

function sampleTurnPath(path, eased, fromHeading, toHeading) {
  const key = turnArcKey(fromHeading, toHeading);
  const start = { x: path.startX, y: path.startY };
  const end = { x: path.endX, y: path.endY };
  if (key === 'W-S' || key === 'W-N') {
    return sampleTurnAxisPath(start, end, eased, 'x');
  }
  if (key === 'S-E' || key === 'N-E') {
    return sampleTurnAxisPath(start, end, eased, 'y');
  }
  return sampleTurnBezier(path, eased);
}

function sampleTurnHeadingForPath(event, eased) {
  const key = turnArcKey(event.fromHeading, event.toHeading);
  const delay = TURN_AXIS_SECOND_DELAY;
  if (key === 'W-S' || key === 'W-N' || key === 'S-E' || key === 'N-E') {
    if (eased <= delay) return event.fromHeading;
    const local = (eased - delay) / (1 - delay);
    return lerpAngleSweep(event.fromHeading, event.headingSweepRad, local);
  }
  return lerpAngleSweep(event.fromHeading, event.headingSweepRad, eased);
}

function turnArcKey(fromHeading, toHeading) {
  return `${headingCardinalLabel(fromHeading)}-${headingCardinalLabel(toHeading)}`;
}

function turnExitPoint(junctionX, junctionY, fromHeading, toHeading) {
  const key = turnArcKey(fromHeading, toHeading);
  const code = TURN_EXIT_TRACK[key];
  const box = code ? TRACK[code] : null;
  const f = TURN_EXIT_SEGMENT_FRAC;
  if (box) {
    const cx = (box.xMinM + box.xMaxM) / 2;
    const cy = (box.yMinM + box.yMaxM) / 2;
    if (key === 'W-S') {
      return { x: cx, y: box.yMinM + (box.yMaxM - box.yMinM) * f };
    }
    if (key === 'S-E') {
      return { x: box.xMinM + (box.xMaxM - box.xMinM) * f, y: cy };
    }
    if (key === 'W-N') {
      return { x: uColumnCenterX(), y: junctionY - LEN * f };
    }
    if (key === 'N-E') {
      return { x: box.xMinM + (box.xMaxM - box.xMinM) * f, y: cy };
    }
  }
  const label = headingCardinalLabel(toHeading);
  if (label === 'S') return { x: junctionX, y: junctionY + LEN * f };
  if (label === 'N') return { x: junctionX, y: junctionY - LEN * f };
  if (label === 'E') return { x: junctionX + LEN * f, y: junctionY };
  if (label === 'W') return { x: junctionX - LEN * f, y: junctionY };
  return { x: junctionX, y: junctionY };
}

function turnBezierControl(start, end, fromHeading, toHeading) {
  const key = turnArcKey(fromHeading, toHeading);
  if (key === 'W-S' || key === 'W-N') {
    return {
      x: end.x + (start.x - end.x) * 0.22,
      y: start.y + (end.y - start.y) * 0.48,
    };
  }
  if (key === 'S-E' || key === 'N-E') {
    return {
      x: start.x + (end.x - start.x) * 0.48,
      y: end.y + (start.y - end.y) * 0.22,
    };
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function turnApproachStart(junctionX, junctionY, fromHeading) {
  const label = headingCardinalLabel(fromHeading);
  const f = TURN_START_SEGMENT_FRAC;
  const along = LEN * f;
  if (label === 'W') {
    const westBound = Math.floor(junctionX / LEN) * LEN;
    return { x: westBound + along, y: junctionY };
  }
  if (label === 'E') {
    const westBound = Math.floor(junctionX / LEN) * LEN;
    return { x: westBound + LEN * (1 - f), y: junctionY };
  }
  if (label === 'S') {
    /** 南向進彎：起點須在 junction 北側（沿 D 柱下行），不可用格線 northBound+2/3 以免越過 T3 彎道 */
    return { x: junctionX, y: junctionY - LEN * (1 - f) };
  }
  if (label === 'N') {
    const northBound = Math.floor(junctionY / LEN) * LEN;
    return { x: junctionX, y: northBound + LEN * (1 - f) };
  }
  return { x: junctionX, y: junctionY };
}

function resolveInnerTurnArc(junctionX, junctionY, fromHeading, toHeading) {
  const key = turnArcKey(fromHeading, toHeading);
  if (!TURN_EXIT_TRACK[key] && headingCardinalLabel(fromHeading) == null) {
    return {
      startX: junctionX,
      startY: junctionY,
      endX: junctionX,
      endY: junctionY,
      ctrlX: junctionX,
      ctrlY: junctionY,
      pivot: true,
    };
  }
  const start = turnApproachStart(junctionX, junctionY, fromHeading);
  const exit = turnExitPoint(junctionX, junctionY, fromHeading, toHeading);
  const ctrl = turnBezierControl(start, exit, fromHeading, toHeading);
  return {
    startX: start.x,
    startY: start.y,
    endX: exit.x,
    endY: exit.y,
    ctrlX: ctrl.x,
    ctrlY: ctrl.y,
    pivot: false,
  };
}

function sampleTurnBezier(path, t) {
  const u = clamp01(t);
  const o = 1 - u;
  return {
    x: o * o * path.startX + 2 * o * u * path.ctrlX + u * u * path.endX,
    y: o * o * path.startY + 2 * o * u * path.ctrlY + u * u * path.endY,
  };
}

function dUpperCenter(n) {
  const xMax = 900 - (n - 1) * LEN;
  return {
    x: xMax - LEN / 2,
    y: (D_UPPER_Y_MIN + D_UPPER_Y_MAX) / 2,
    track: dTrack(n),
  };
}

function dLowerCenter(n) {
  const xMin = 100 + (n - 20) * LEN;
  return {
    x: xMin + LEN / 2,
    y: (D_LOWER_Y_MIN + D_LOWER_Y_MAX) / 2,
    track: dTrack(n),
  };
}

function uLowerCenter(n) {
  const { xMin, xMax } = uLowerXBounds(n);
  return {
    x: (xMin + xMax) / 2,
    y: (U_LOWER_Y_MIN + U_LOWER_Y_MAX) / 2,
    track: uTrack(n),
  };
}

function uUpperCenter(n) {
  const { xMin, xMax } = uUpperXBounds(n);
  return {
    x: (xMin + xMax) / 2,
    y: (U_UPPER_Y_MIN + U_UPPER_Y_MAX) / 2,
    track: uTrack(n),
  };
}

/** 東向進 N2W上行：僅跑中心仍在 dockX 以西的 U 段，避免 U01 過站再倒車 */
function uUpperCentersEastboundBeforeDock(dockX) {
  const out = [];
  for (let n = 16; n >= 1; n -= 1) {
    const st = uUpperCenter(n);
    if (st.x > dockX + 0.5) continue;
    out.push(st);
  }
  return out;
}

function trackCenter(trackCode) {
  const box = TRACK[trackCode];
  if (!box) return null;
  return {
    x: (box.xMinM + box.xMaxM) / 2,
    y: (box.yMinM + box.yMaxM) / 2,
    track: trackCode,
  };
}

function dwellDurationMs() {
  return DOCKING_DWELL_MS;
}

function dwellPhaseBounds() {
  const openStart = STOP_SETTLE_MS;
  const openEnd = openStart + DOOR_SYNC_OPEN_MS;
  const dwellHoldEnd = openEnd + STATION_DWELL_MS;
  const doorCloseEnd = dwellHoldEnd + DOOR_CLOSE_MS;
  const psdCloseEnd = doorCloseEnd + PSD_CLOSE_MS;
  return { openStart, openEnd, dwellHoldEnd, doorCloseEnd, psdCloseEnd };
}

function psdOpenPercentAtDwellMs(elapsedInEvent) {
  if (elapsedInEvent <= 0) return 0;
  const { openStart, openEnd, dwellHoldEnd, doorCloseEnd, psdCloseEnd } = dwellPhaseBounds();
  if (elapsedInEvent < openStart) return 0;
  if (elapsedInEvent < openEnd) {
    return Math.round(((elapsedInEvent - openStart) / DOOR_SYNC_OPEN_MS) * 100);
  }
  if (elapsedInEvent < doorCloseEnd) return 100;
  if (elapsedInEvent < psdCloseEnd) {
    return Math.round((1 - (elapsedInEvent - doorCloseEnd) / PSD_CLOSE_MS) * 100);
  }
  return 0;
}

function travelEvent(x0, y0, x1, y1, heading, durationMs, options = {}) {
  return {
    type: 'travel',
    x0,
    y0,
    x1,
    y1,
    heading,
    durationMs,
    approachTurnTo: options.approachTurnTo ?? null,
    /** 進站前減速至完全停止（ease-out，終點速度為 0） */
    easeOutStop: options.easeOutStop ?? false,
  };
}

function dwellEvent(station) {
  return {
    type: 'dwell',
    x: station.x,
    y: station.y,
    heading: station.heading,
    station: station.station ?? station.track,
    durationMs: dwellDurationMs(),
  };
}

/** 依 refField 段內命中決定軌道代碼（與前端 trackNetwork/locate 一致） */
function motionTrackCode(x, y, fallback) {
  const hits = MAP_REF_FIELD_SEGMENTS.filter(
    (seg) =>
      x >= seg.bounds.xMinM &&
      x <= seg.bounds.xMaxM &&
      y >= seg.bounds.yMinM &&
      y <= seg.bounds.yMaxM,
  );
  if (hits.length === 0) return fallback ?? classifyT3FieldTrack(x, y);
  if (hits.length === 1) return hits[0].trackCode ?? fallback ?? classifyT3FieldTrack(x, y);
  hits.sort((a, b) => a.trackId.localeCompare(b.trackId));
  return hits[0].trackCode ?? fallback ?? classifyT3FieldTrack(x, y);
}

function signalWaitEvent(station) {
  return {
    type: 'signal_wait',
    x: station.x,
    y: station.y,
    heading: station.heading,
    station: station.signalId ?? station.track,
    durationMs: SIGNAL_WAIT_MS,
  };
}

function turnEvent(x, y, fromHeading, toHeading) {
  return {
    type: 'turn',
    x,
    y,
    fromHeading,
    toHeading,
    headingSweepRad: shortestAngleDiff(fromHeading, toHeading),
    durationMs: TURN_MS,
  };
}

function appendStationRun(timeline, start, stations, heading) {
  let cx = start.x;
  let cy = start.y;
  for (let i = 0; i < stations.length; i++) {
    const st = { ...stations[i], heading };
    appendTravelWithSignalStops(timeline, cx, cy, st.x, st.y, heading, INTER_STATION_TRAVEL_MS);
    cx = st.x;
    cy = st.y;
  }
  return { x: cx, y: cy };
}

/** 僅跑進指定站點列表中、沿 heading 方向已越過起點的段（避免停靠點在段西側時先回頭） */
function appendStationRunAhead(timeline, start, stations, heading) {
  const ahead =
    heading === HEADING.WEST
      ? stations.filter((st) => st.x <= start.x + 0.5)
      : heading === HEADING.EAST
        ? stations.filter((st) => st.x >= start.x - 0.5)
        : heading === HEADING.SOUTH
          ? stations.filter((st) => st.y >= start.y - 0.5)
          : heading === HEADING.NORTH
            ? stations.filter((st) => st.y <= start.y + 0.5)
            : stations;
  if (ahead.length === 0) return { x: start.x, y: start.y };
  return appendStationRun(timeline, start, ahead, heading);
}

function appendAxisAlignedTravel(
  timeline,
  x0,
  y0,
  x1,
  y1,
  primaryHeading,
  durationMs,
  options = {},
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dx < 0.5 && dy < 0.5) return;

  if (dx < 0.5) {
    const vHeading = y1 >= y0 ? HEADING.SOUTH : HEADING.NORTH;
    appendTravelWithSignalStops(timeline, x0, y0, x1, y1, vHeading, durationMs, options);
    return;
  }
  if (dy < 0.5) {
    appendTravelWithSignalStops(timeline, x0, y0, x1, y1, primaryHeading, durationMs, options);
    return;
  }

  const horizontalFirst =
    primaryHeading === HEADING.WEST || primaryHeading === HEADING.EAST;
  const midMs = Math.max(
    400,
    Math.round(durationMs * (horizontalFirst ? dx / (dx + dy) : dy / (dx + dy))),
  );
  const remainMs = Math.max(400, durationMs - midMs);

  if (horizontalFirst) {
    appendTravelWithSignalStops(timeline, x0, y0, x1, y0, primaryHeading, midMs);
    const vHeading = y1 >= y0 ? HEADING.SOUTH : HEADING.NORTH;
    appendTravelWithSignalStops(timeline, x1, y0, x1, y1, vHeading, remainMs, options);
    return;
  }

  appendTravelWithSignalStops(timeline, x0, y0, x0, y1, primaryHeading, midMs);
  const hHeading = x1 >= x0 ? HEADING.EAST : HEADING.WEST;
  appendTravelWithSignalStops(timeline, x0, y1, x1, y1, hHeading, remainMs, options);
}

function appendDockingDwell(
  timeline,
  from,
  docking,
  travelHeading,
  travelMs = INTER_STATION_TRAVEL_MS,
  dwellLabel,
) {
  const dx = docking.x - from.x;
  const dy = docking.y - from.y;
  const approachHeading =
    Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0
        ? HEADING.EAST
        : HEADING.WEST
      : dy >= 0
        ? HEADING.SOUTH
        : HEADING.NORTH;
  appendAxisAlignedTravel(
    timeline,
    from.x,
    from.y,
    docking.x,
    docking.y,
    approachHeading,
    travelMs,
    { easeOutStop: true },
  );
  timeline.push(
    dwellEvent({
      x: docking.x,
      y: docking.y,
      heading: docking.heading,
      station: dwellLabel || docking.station || docking.name || docking.id,
      stationId: docking.stationId,
      track: dwellLabel || docking.station || docking.name || docking.id,
    }),
  );
  return { x: docking.x, y: docking.y };
}

function appendCornerEntry(timeline, x0, y0, x1, y1, fromHeading, toHeading, entryMs = COLUMN_ENTRY_MS) {
  const path = resolveInnerTurnArc(x1, y1, fromHeading, toHeading);
  const dist = Math.hypot(x0 - path.startX, y0 - path.startY);
  if (dist > 0.5) {
    const ms = Math.min(entryMs, Math.max(600, Math.round((dist / 6) * 1000)));
    timeline.push(travelEvent(x0, y0, path.startX, path.startY, fromHeading, ms));
  }
  timeline.push(turnEvent(x1, y1, fromHeading, toHeading));
  return { x: path.endX, y: path.endY };
}

/** 直行到進彎段 2/3 點後立即 turn（不在段底硬轉） */
function appendApproachToTurn(timeline, pos, junctionX, junctionY, fromHeading, toHeading) {
  const path = resolveInnerTurnArc(junctionX, junctionY, fromHeading, toHeading);
  const dist = Math.hypot(pos.x - path.startX, pos.y - path.startY);
  if (dist > 0.5) {
    const ms = Math.min(INTER_STATION_TRAVEL_MS, Math.max(600, Math.round((dist / 6) * 1000)));
    appendTravelWithSignalStops(
      timeline,
      pos.x,
      pos.y,
      path.startX,
      path.startY,
      fromHeading,
      ms,
    );
  }
  return appendCornerEntry(
    timeline,
    path.startX,
    path.startY,
    junctionX,
    junctionY,
    fromHeading,
    toHeading,
  );
}

/** 號誌固定 5s、停靠固定 36s，其餘事件等比縮放至 leg 總長 6 分鐘 */
function normalizeLegDuration(timeline, targetMs) {
  const signalCount = timeline.filter((e) => e.type === 'signal_wait').length;
  const dwellCount = timeline.filter((e) => e.type === 'dwell').length;
  const fixedTotalMs = signalCount * SIGNAL_WAIT_MS + dwellCount * DOCKING_DWELL_MS;
  const adjustable = timeline.filter((e) => e.type !== 'signal_wait' && e.type !== 'dwell');
  const adjustableRawMs = adjustable.reduce((s, e) => s + e.durationMs, 0);
  const budgetMs = targetMs - fixedTotalMs;
  const scale = adjustableRawMs > 0 ? budgetMs / adjustableRawMs : 1;

  return timeline.map((ev) => {
    if (ev.type === 'signal_wait') {
      return { ...ev, durationMs: SIGNAL_WAIT_MS };
    }
    if (ev.type === 'dwell') {
      return { ...ev, durationMs: DOCKING_DWELL_MS };
    }
    return {
      ...ev,
      durationMs: Math.max(250, Math.round(ev.durationMs * scale)),
    };
  });
}

function rejoinLaneY(timeline, pos, laneY, primaryHeading, ms = 2500) {
  if (Math.abs(pos.y - laneY) < 0.5) return { x: pos.x, y: laneY };
  appendAxisAlignedTravel(timeline, pos.x, pos.y, pos.x, laneY, primaryHeading, ms);
  return { x: pos.x, y: laneY };
}

function pushNamedDockingDwell(timeline, docking, label) {
  timeline.push(
    dwellEvent({
      x: docking.x,
      y: docking.y,
      heading: docking.heading,
      station: label,
      track: label,
    }),
  );
}

function trackFamilyFromCode(code) {
  if (!code || typeof code !== 'string') return null;
  if (code.startsWith('D')) return 'D';
  if (code.startsWith('U')) return 'U';
  return null;
}

/** 規則1 起點：N2W下行月台在 D 上行正線上等待 */
function rule1StartOnDTrack(n2wDown) {
  return dockOnTrackFamily(n2wDown, 'D');
}

/**
 * 停靠點停站座標：直接使用地圖 DockingPoint refFieldXM/refFieldYM（站點名稱如 S2W下行）。
 * T3 僅 X 對齊 D/U 柱心；其餘僅在 refFieldY 明顯偏離正線時才 snap 至軌道族 Y。
 */
function dockOnTrackFamily(docking, family) {
  let x = docking.x;
  let y = docking.y;
  if (docking.station === 'T3') {
    const colX = family === 'D' ? dColumnCenterX() : uColumnCenterX();
    return { x: colX, y: docking.y, heading: docking.heading };
  }
  if (docking.station === 'S2W') {
    const laneY = family === 'D' ? D_LOWER_LANE_Y : U_LOWER_LANE_Y;
    if (Math.abs(y - laneY) > 2) y = laneY;
    return { x, y, heading: docking.heading };
  }
  if (docking.station === 'N2W') {
    const laneY = family === 'D' ? D_UPPER_LANE_Y : U_UPPER_LANE_Y;
    if (Math.abs(y - laneY) > 2) y = laneY;
    return { x, y, heading: docking.heading };
  }
  return { x, y, heading: docking.heading };
}

function isDockingTrackLabel(label) {
  return typeof label === 'string' && label.length > 0 && !/^[DU]\d{2}$/i.test(label);
}

/** 依 leg 軌道族（D / U）解析顯示用軌道代碼，避免停靠點座標落在另一軌道列 */
function classifyTrackOnFamily(x, y, family) {
  if (family === 'D') {
    if (inHalfOpen(x, T3_D_X_MIN, T3_D_X_MAX) && inHalfOpen(y, T3_D_Y_START, T3_D_Y_END)) {
      return classifyT3DColumn(y);
    }
    if (
      Math.abs(y - D_UPPER_LANE_Y) <= 2 ||
      inHalfOpen(y, D_UPPER_Y_MIN, D_UPPER_Y_MAX)
    ) {
      return classifyDUpperRow(x);
    }
    if (
      Math.abs(y - D_LOWER_LANE_Y) <= 2 ||
      inHalfOpen(y, D_LOWER_Y_MIN, D_LOWER_Y_MAX)
    ) {
      return classifyDLowerRow(x);
    }
  }
  if (family === 'U') {
    if (inHalfOpen(x, T3_U_X_MIN, T3_U_X_MAX) && inHalfOpen(y, 107, 300)) {
      return classifyT3UColumn(y);
    }
    if (
      Math.abs(y - U_UPPER_LANE_Y) <= 2 ||
      inHalfOpen(y, U_UPPER_Y_MIN, U_UPPER_Y_MAX)
    ) {
      return classifyUUpperRow(x);
    }
    if (
      Math.abs(y - U_LOWER_LANE_Y) <= 2 ||
      inHalfOpen(y, U_LOWER_Y_MIN, U_LOWER_Y_MAX)
    ) {
      return classifyULowerRow(x);
    }
  }
  return classifyT3FieldTrack(x, y);
}

function resolveMotionTrack(x, y, fallback, trackFamily) {
  if (isDockingTrackLabel(fallback)) {
    return fallback;
  }
  let code = motionTrackCode(x, y, fallback);
  if (trackFamily && code) {
    const fam = trackFamilyFromCode(code);
    if (fam && fam !== trackFamily) {
      code = classifyTrackOnFamily(x, y, trackFamily);
    }
  }
  return code ?? fallback ?? classifyT3FieldTrack(x, y);
}

/** 規則1：全程 D 軌道（N2W下行 → D01–D16 → T3下行 → D20–D33 → S2W下行） */
function buildRule1Timeline() {
  const timeline = [];
  const n2wDown = getDockingStopByLabel('N2W下行');
  const t3Down = getDockingStopByLabel('T3下行');
  const s2wDown = getDockingStopByLabel('S2W下行');
  const dColX = dColumnCenterX();
  const verticalLegMs = VERTICAL_TRAVEL_MS / 2 - COLUMN_ENTRY_MS;

  const rule1Start = rule1StartOnDTrack(n2wDown);
  let pos = { ...rule1Start };
  pushNamedDockingDwell(timeline, rule1Start, 'N2W下行');

  const upperWest = [];
  for (let n = 1; n <= 15; n++) upperWest.push(dUpperCenter(n));
  pos = appendStationRunAhead(timeline, pos, upperWest, HEADING.WEST);

  pos = appendApproachToTurn(
    timeline,
    pos,
    dColX,
    D_UPPER_LANE_Y,
    HEADING.WEST,
    HEADING.SOUTH,
  );

  const t3DwellY = t3Down.y;
  appendTravelWithSignalStops(
    timeline,
    pos.x,
    pos.y,
    dColX,
    t3DwellY,
    HEADING.SOUTH,
    verticalLegMs,
  );
  pushNamedDockingDwell(
    timeline,
    dockOnTrackFamily(t3Down, 'D'),
    'T3下行',
  );

  pos = { x: dColX, y: t3DwellY };
  pos = appendApproachToTurn(
    timeline,
    pos,
    dColX,
    D_LOWER_LANE_Y,
    HEADING.SOUTH,
    HEADING.EAST,
  );

  const lowerEast = [];
  /** D20–D33 後直接進 S2W下行停靠點；不可先至 D34 段心 (825) 再倒車 */
  for (let n = 20; n <= 33; n++) lowerEast.push(dLowerCenter(n));
  pos = appendStationRun(timeline, pos, lowerEast, HEADING.EAST);

  const s2wDock = dockOnTrackFamily(s2wDown, 'D');
  appendDockingDwell(
    timeline,
    pos,
    s2wDock,
    HEADING.EAST,
    INTER_STATION_TRAVEL_MS,
    'S2W下行',
  );

  return normalizeLegDuration(timeline, TARGET_LEG_DURATION_MS);
}

/** 規則2：全程 U 軌道（S2W上行 → U35–U20 → T3上行 → U16–U03 → N2W上行） */
function buildRule2Timeline() {
  const timeline = [];
  const s2wUp = getDockingStopByLabel('S2W上行');
  const t3Up = getDockingStopByLabel('T3上行');
  const n2wUp = getDockingStopByLabel('N2W上行');
  const uColX = uColumnCenterX();
  const verticalLegMs = VERTICAL_TRAVEL_MS / 2 - COLUMN_ENTRY_MS;

  const s2wStart = dockOnTrackFamily(s2wUp, 'U');
  let pos = { x: s2wStart.x, y: s2wStart.y };
  pushNamedDockingDwell(timeline, s2wStart, 'S2W上行');

  pos = rejoinLaneY(timeline, pos, U_LOWER_LANE_Y, HEADING.WEST);

  const lowerWest = [];
  for (let n = 35; n >= 20; n--) lowerWest.push(uLowerCenter(n));
  pos = appendStationRunAhead(timeline, pos, lowerWest, HEADING.WEST);

  pos = appendApproachToTurn(
    timeline,
    pos,
    uColX,
    U_LOWER_LANE_Y,
    HEADING.WEST,
    HEADING.NORTH,
  );

  const t3DwellY = t3Up.y;
  appendTravelWithSignalStops(
    timeline,
    pos.x,
    pos.y,
    uColX,
    t3DwellY,
    HEADING.NORTH,
    verticalLegMs,
  );
  pushNamedDockingDwell(
    timeline,
    dockOnTrackFamily(t3Up, 'U'),
    'T3上行',
  );

  const northEastArc = resolveInnerTurnArc(uColX, U_UPPER_LANE_Y, HEADING.NORTH, HEADING.EAST);
  appendTravelWithSignalStops(
    timeline,
    uColX,
    t3DwellY,
    northEastArc.startX,
    northEastArc.startY,
    HEADING.NORTH,
    verticalLegMs,
  );
  timeline.push(turnEvent(uColX, U_UPPER_LANE_Y, HEADING.NORTH, HEADING.EAST));
  pos = { x: northEastArc.endX, y: northEastArc.endY };

  const n2wDock = dockOnTrackFamily(n2wUp, 'U');
  const upperEast = uUpperCentersEastboundBeforeDock(n2wDock.x);
  pos = appendStationRun(timeline, pos, upperEast, HEADING.EAST);

  appendDockingDwell(
    timeline,
    pos,
    n2wDock,
    HEADING.EAST,
    INTER_STATION_TRAVEL_MS,
    'N2W上行',
  );

  return normalizeLegDuration(timeline, TARGET_LEG_DURATION_MS);
}

function buildDownTimeline() {
  return buildRule1Timeline();
}

function buildUpTimeline() {
  return buildRule2Timeline();
}

function getDockingByStationId(stationId) {
  const id = String(stationId ?? '').trim();
  if (!id) return null;
  return T3_DOCKING_STOPS.byStationId?.[id] ?? null;
}

function inferTravelHeadingBetween(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? HEADING.EAST : HEADING.WEST;
  }
  return dy >= 0 ? HEADING.SOUTH : HEADING.NORTH;
}

function resolvePlannedRouteTrackFamily(stops) {
  const first = stops[0];
  if (first?.label && DOCKING_TRACK_FAMILY[first.label]) {
    return DOCKING_TRACK_FAMILY[first.label];
  }
  const leg = inferLegFromLabel(first?.label) ?? 'down';
  return leg === 'up' ? 'U' : 'D';
}

/** 依地圖路線清單 stationIds 建立軌道行進時間軸（站間沿軌道族座標移動） */
function stationIdsKey(stationIds) {
  return stationIds.map((id) => String(id).trim()).join(',');
}

function isSameStationIdSequence(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((id, i) => String(id).trim() === String(b[i]).trim());
}

/**
 * 地圖路線若與正線站序一致，直接沿用 buildRule1/2 完整軌道軌跡（含 D01–D33 等段），
 * 避免站間直線插值導致車輛切過場域道路。
 */
function buildPlannedRouteTimeline(stationIds) {
  const ids = stationIds.map((id) => String(id).trim()).filter(Boolean);
  if (ids.length < 2) return [];

  if (isSameStationIdSequence(ids, MAINLINE_STATION_IDS_BY_LEG.down)) {
    return buildRule1Timeline();
  }
  if (isSameStationIdSequence(ids, MAINLINE_STATION_IDS_BY_LEG.up)) {
    return buildRule2Timeline();
  }

  const stops = ids.map((id) => getDockingByStationId(id)).filter(Boolean);
  if (stops.length < 2) return [];

  const timeline = [];
  const family = resolvePlannedRouteTrackFamily(stops);
  const first = dockOnTrackFamily(stops[0], family);
  let pos = { x: first.x, y: first.y };

  pushNamedDockingDwell(
    timeline,
    first,
    first.label || first.name || ids[0],
  );

  for (let i = 1; i < stops.length; i++) {
    const raw = stops[i];
    const docked = dockOnTrackFamily(raw, family);
    pos = appendDockingDwell(
      timeline,
      pos,
      docked,
      docked.heading ?? inferTravelHeadingBetween(pos.x, pos.y, docked.x, docked.y),
      INTER_STATION_TRAVEL_MS,
      docked.label || docked.name || raw.stationId,
    );
  }

  return normalizeLegDuration(timeline, TARGET_LEG_DURATION_MS);
}

function buildPlannedRoutePlan() {
  const routes = T3_DOCKING_STOPS.plannedRoutes ?? [];
  const plan = [];
  for (const route of routes) {
    const stops = route.stationIds.map((id) => getDockingByStationId(id)).filter(Boolean);
    const timeline = buildPlannedRouteTimeline(route.stationIds);
    const durationMs = timelineDurationMs(timeline);
    if (durationMs <= 0 || stops.length < 2) continue;
    plan.push({
      routeId: route.routeId,
      displayName: route.displayName,
      stationIds: route.stationIds,
      timeline,
      durationMs,
      trackFamily: resolvePlannedRouteTrackFamily(stops),
    });
  }
  return plan;
}

const ROUTE_TIMELINE_DOWN = buildDownTimeline();
const ROUTE_TIMELINE_UP = buildUpTimeline();
const PLANNED_ROUTE_PLAN = buildPlannedRoutePlan();
const USE_PLANNED_MAP_ROUTES = PLANNED_ROUTE_PLAN.length > 0;
const MAP_PLANNED_ROUTES = T3_DOCKING_STOPS.plannedRoutes ?? [];

function resolvePlannedRouteLegAtLocal(localMs) {
  let cursor = 0;
  for (let i = 0; i < PLANNED_ROUTE_PLAN.length; i++) {
    const plan = PLANNED_ROUTE_PLAN[i];
    if (localMs < cursor + plan.durationMs) {
      return {
        plan,
        planIndex: i,
        legLocal: localMs - cursor,
      };
    }
    cursor += plan.durationMs;
  }
  return null;
}

function timelineDurationMs(timeline) {
  return timeline.reduce((sum, ev) => sum + ev.durationMs, 0);
}

const LEG_DURATION_MS = TARGET_LEG_DURATION_MS;
const PLANNED_CYCLE_MS = PLANNED_ROUTE_PLAN.reduce((sum, plan) => sum + plan.durationMs, 0);
/** 一趟完整週期：地圖路線清單串接，或預設下行＋上行 */
const CYCLE_MS =
  USE_PLANNED_MAP_ROUTES && PLANNED_CYCLE_MS > 0
    ? PLANNED_CYCLE_MS
    : LEG_DURATION_MS * 2;

/** 舊版比例（文件／測試相容） */
const SEG1_FRAC = 2.5 / 6;
const SEG2_FRAC = 1 / 6;
const SEG3_FRAC = 2.5 / 6;

const ROUTE_SEG_DOWN = [
  { fraction: SEG1_FRAC, x0: 875, x1: 100, y: 101.75, heading: HEADING.WEST },
  { fraction: SEG2_FRAC, x: 102, y0: 103.5, y1: 303.5, heading: HEADING.SOUTH },
  { fraction: SEG3_FRAC, x0: 100, x1: 850, y: 305.25, heading: HEADING.EAST },
];

const ROUTE_SEG_UP = [
  { fraction: SEG1_FRAC, x0: 875, x1: 100, y: 301.75, heading: HEADING.WEST },
  { fraction: SEG2_FRAC, x: 105.5, y0: 303.5, y1: 103.5, heading: HEADING.NORTH },
  { fraction: SEG3_FRAC, x0: 100, x1: 850, y: 105.25, heading: HEADING.EAST },
];

function sampleTravel(event, elapsedInEvent, trackFamily) {
  const rawT = event.durationMs > 0 ? clamp01(elapsedInEvent / event.durationMs) : 1;
  const localT = event.easeOutStop ? 1 - (1 - rawT) ** 3 : rawT;
  const x = lerp(event.x0, event.x1, localT);
  const y = lerp(event.y0, event.y1, localT);
  let steering_angle = 0;

  if (event.approachTurnTo != null && localT > 1 - APPROACH_TURN_FRAC) {
    const approachT = (localT - (1 - APPROACH_TURN_FRAC)) / APPROACH_TURN_FRAC;
    const sweep = shortestAngleDiff(event.heading, event.approachTurnTo);
    const sign = steerSignForSweep(sweep);
    steering_angle = approachT * MAX_STEER_RAD * sign;
  }

  return {
    x,
    y,
    heading: event.heading,
    steering_angle,
    operation_action: null,
    operation_actions: [],
    ...zeroDoorOpenPercents(),
    dwelling: false,
    ease_out_stop: event.easeOutStop ?? false,
    track: resolveMotionTrack(x, y, null, trackFamily),
    eventElapsedMs: elapsedInEvent,
    eventDurationMs: event.durationMs,
  };
}

function zeroDoorOpenPercents() {
  const doors = {};
  for (const key of DOOR_OPEN_PERCENT_FIELDS) {
    doors[key] = 0;
  }
  doors.door_open_percent = 0;
  return doors;
}

function sampleDoorOpenPercents(elapsedInEvent, doorOpenEnd, dwellEnd, doorCloseEnd) {
  const doors = {};
  for (let i = 0; i < DOOR_OPEN_PERCENT_FIELDS.length; i += 1) {
    const key = DOOR_OPEN_PERCENT_FIELDS[i];
    const stagger = i * DOOR_STAGGER_MS;
    if (elapsedInEvent < doorOpenEnd) {
      const t = Math.max(0, elapsedInEvent - stagger);
      doors[key] = Math.round(lerp(0, 100, clamp01(t / DOOR_OPEN_MS)));
    } else if (elapsedInEvent < dwellEnd) {
      doors[key] = 100;
    } else if (elapsedInEvent < doorCloseEnd) {
      const t = Math.max(0, elapsedInEvent - dwellEnd - stagger);
      doors[key] = Math.round(lerp(100, 0, clamp01(t / DOOR_CLOSE_MS)));
    } else {
      doors[key] = 0;
    }
  }
  doors.door_open_percent = Math.max(...DOOR_OPEN_PERCENT_FIELDS.map((k) => doors[k]));
  return doors;
}

function sampleSyncedDoorOpenPercents(syncElapsed, syncOpenMs, holdEndSync, closeEndSync) {
  const doors = {};
  for (const key of DOOR_OPEN_PERCENT_FIELDS) {
    if (syncElapsed < syncOpenMs) {
      doors[key] = Math.round(lerp(0, 100, clamp01(syncElapsed / syncOpenMs)));
    } else if (syncElapsed < holdEndSync) {
      doors[key] = 100;
    } else if (syncElapsed < closeEndSync) {
      const t = syncElapsed - holdEndSync;
      doors[key] = Math.round(lerp(100, 0, clamp01(t / DOOR_CLOSE_MS)));
    } else {
      doors[key] = 0;
    }
  }
  doors.door_open_percent = Math.max(...DOOR_OPEN_PERCENT_FIELDS.map((k) => doors[k]));
  return doors;
}

function sampleDwell(event, elapsedInEvent, trackFamily) {
  const { openStart, openEnd, dwellHoldEnd, doorCloseEnd, psdCloseEnd } = dwellPhaseBounds();

  let operation_action = null;
  let operation_actions = [];
  let doorFields = zeroDoorOpenPercents();

  if (elapsedInEvent >= openStart && elapsedInEvent < doorCloseEnd) {
    const syncElapsed = Math.max(0, elapsedInEvent - openStart);
    doorFields = sampleSyncedDoorOpenPercents(
      syncElapsed,
      DOOR_SYNC_OPEN_MS,
      DOOR_SYNC_OPEN_MS + STATION_DWELL_MS,
      DOOR_SYNC_OPEN_MS + STATION_DWELL_MS + DOOR_CLOSE_MS,
    );
  }

  if (elapsedInEvent < openStart) {
    operation_action = null;
    operation_actions = [];
  } else if (elapsedInEvent < openEnd) {
    operation_action = 'door_open';
    operation_actions = ['psd_open', 'door_open'];
  } else if (elapsedInEvent < dwellHoldEnd) {
    operation_action = 'door_open';
    operation_actions = ['psd_open', 'door_open'];
  } else if (elapsedInEvent < doorCloseEnd) {
    operation_action = 'door_close';
    operation_actions = ['door_close'];
  } else if (elapsedInEvent < psdCloseEnd) {
    operation_action = 'psd_close';
    operation_actions = ['psd_close'];
  }

  return {
    x: event.x,
    y: event.y,
    heading: event.heading,
    steering_angle: 0,
    operation_action,
    operation_actions,
    ...doorFields,
    dwelling: true,
    station: event.station,
    stationId: event.stationId,
    track: resolveMotionTrack(event.x, event.y, event.station, trackFamily),
    eventElapsedMs: elapsedInEvent,
    eventDurationMs: event.durationMs,
  };
}

function sampleTurn(event, elapsedInEvent, trackFamily) {
  const localT = event.durationMs > 0 ? clamp01(elapsedInEvent / event.durationMs) : 1;
  const eased = 0.5 - 0.5 * Math.cos(localT * Math.PI);
  const sweep = event.headingSweepRad;
  const heading = sampleTurnHeadingForPath(event, eased);
  const sign = steerSignForSweep(sweep);
  const steering_angle = Math.sin(localT * Math.PI) * MAX_STEER_RAD * sign;

  const path = resolveInnerTurnArc(event.x, event.y, event.fromHeading, event.toHeading);
  let x = event.x;
  let y = event.y;
  if (!path.pivot) {
    const pt = sampleTurnPath(path, eased, event.fromHeading, event.toHeading);
    x = pt.x;
    y = pt.y;
  }

  return {
    x,
    y,
    heading,
    steering_angle,
    operation_action: null,
    operation_actions: [],
    ...zeroDoorOpenPercents(),
    dwelling: false,
    track: resolveMotionTrack(x, y, null, trackFamily),
    eventElapsedMs: elapsedInEvent,
    eventDurationMs: event.durationMs,
  };
}

function sampleSignalWait(event, elapsedInEvent, trackFamily) {
  return {
    x: event.x,
    y: event.y,
    heading: event.heading,
    steering_angle: 0,
    operation_action: 'signal',
    operation_actions: ['signal'],
    ...zeroDoorOpenPercents(),
    dwelling: true,
    station: event.station,
    track: resolveMotionTrack(event.x, event.y, null, trackFamily),
    eventElapsedMs: elapsedInEvent,
    eventDurationMs: event.durationMs,
  };
}

function sampleTimeline(timeline, elapsedInLegMs, options = {}) {
  const trackFamily = options.trackFamily ?? null;
  let cursor = 0;
  for (const event of timeline) {
    const next = cursor + event.durationMs;
    if (elapsedInLegMs < next) {
      const local = elapsedInLegMs - cursor;
      if (event.type === 'travel') return sampleTravel(event, local, trackFamily);
      if (event.type === 'dwell') return sampleDwell(event, local, trackFamily);
      if (event.type === 'turn') return sampleTurn(event, local, trackFamily);
      if (event.type === 'signal_wait') return sampleSignalWait(event, local, trackFamily);
    }
    cursor = next;
  }

  const last = timeline[timeline.length - 1];
  if (!last) {
    return {
      x: 0,
      y: 0,
      heading: 0,
      steering_angle: 0,
      operation_action: null,
      operation_actions: [],
      ...zeroDoorOpenPercents(),
      dwelling: false,
      track: null,
    };
  }

  if (last.type === 'dwell') return sampleDwell(last, last.durationMs, trackFamily);
  if (last.type === 'turn') return sampleTurn(last, last.durationMs, trackFamily);
  if (last.type === 'signal_wait') return sampleSignalWait(last, last.durationMs, trackFamily);
  return sampleTravel(last, last.durationMs, trackFamily);
}

/** 依時間比例在三段路線上線性插值（舊版相容，無轉角／站停） */
function interpolateTimedRoute(segments, progress) {
  const p = clamp01(progress);
  let segStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segEnd = segStart + seg.fraction;
    const isLast = i === segments.length - 1;

    if (p <= segEnd || isLast) {
      const localT = seg.fraction > 0 ? clamp01((p - segStart) / seg.fraction) : 0;
      const x = typeof seg.x === 'number' ? seg.x : lerp(seg.x0, seg.x1, localT);
      const y = typeof seg.y === 'number' ? seg.y : lerp(seg.y0, seg.y1, localT);

      return {
        x,
        y,
        heading: seg.heading,
        steering_angle: 0,
        track: motionTrackCode(x, y, null),
      };
    }
    segStart = segEnd;
  }

  const last = segments[segments.length - 1];
  const x = typeof last.x1 === 'number' ? last.x1 : last.x;
  const y = typeof last.y1 === 'number' ? last.y1 : last.y;
  return {
    x,
    y,
    heading: last.heading,
    steering_angle: 0,
    track: motionTrackCode(x, y, null),
  };
}

/** 模擬資料固定車燈；圖台旋轉僅依 heading，不再依方向切換 head/tail */
const DEFAULT_MOTION_LIGHTS = { head_light_on: true, tail_light_on: false };

function motionWithDefaultLights(motion) {
  return { ...motion, ...DEFAULT_MOTION_LIGHTS };
}

function resolveYardCoords(yardSlot) {
  if (!yardSlot) return null;
  if (yardSlot.kind === 'charge') {
    const slot = yardCharging().find((s) => s.id === yardSlot.slotId);
    if (!slot) return null;
    return { x: slot.x, y: slot.y, heading: slot.heading ?? 0 };
  }
  if (yardSlot.kind === 'park') {
    const slot = yardParking().find((s) => s.id === yardSlot.slotId);
    if (!slot) return null;
    return { x: slot.x, y: slot.y, heading: slot.heading ?? 0 };
  }
  const slot = yardMaint().find((s) => s.id === yardSlot.slotId);
  if (!slot) return null;
  return { x: slot.x, y: slot.y, heading: slot.heading ?? 0 };
}

function yardStationLabel(yardSlot, vehicleStatus) {
  if (!yardSlot) return '整備區';
  if (vehicleStatus === 'charging') {
    if (yardSlot.kind === 'charge') return `充電 ${yardSlot.slotId}`;
    return `充電等候 ${yardSlot.slotId}`;
  }
  if (yardSlot.kind === 'park') return `臨停 ${yardSlot.slotId}`;
  if (/^H\d/i.test(yardSlot.slotId)) return `調度 ${yardSlot.slotId}`;
  if (/^M\d/i.test(yardSlot.slotId)) return `保養 ${yardSlot.slotId}`;
  if (/^W\d/i.test(yardSlot.slotId)) return `洗車 ${yardSlot.slotId}`;
  return `整備 ${yardSlot.slotId}`;
}

function getVehicleFleetTask(vehicleId) {
  const vehicle = fleetBatteryState?.vehicles?.[vehicleId];
  if (!vehicle) return 'unknown';
  if (vehicle.status === 'on_field') return 'shift_run';
  const slotKind = vehicle.yardSlot?.kind;
  if (slotKind === 'charge') return 'charge';
  if (slotKind === 'park') return 'park';
  if (slotKind === 'maint') return 'maintenance';
  if (vehicle.status === 'charging') return 'charge_queue';
  return 'standby';
}

/** 場下車輛：依任務停入充電格 / 臨停格 / 整備格 */
function getVehicleYardMotion(vehicleId) {
  const vehicle = fleetBatteryState?.vehicles?.[vehicleId];
  if (!vehicle || vehicle.status === 'on_field') return null;
  const coords = resolveYardCoords(vehicle.yardSlot);
  if (!coords) return null;
  const slotId = vehicle.yardSlot?.slotId ?? null;
  const station = yardStationLabel(vehicle.yardSlot, vehicle.status);
  const fleetTask = getVehicleFleetTask(vehicleId);
  return motionWithDefaultLights({
    active: false,
    leg: 'yard',
    progress: 0,
    tripCode: 'YARD',
    directionLabel: station,
    track: slotId ?? station,
    yard_slot_id: vehicle.yardSlot?.slotId ?? null,
    ...(typeof vehicle.yardSlot?.subIndex === 'number'
      ? { yard_sub_index: vehicle.yardSlot.subIndex }
      : {}),
    fleet_task: fleetTask,
    x: coords.x,
    y: coords.y,
    heading: coords.heading,
    steering_angle: 0,
    dwelling: true,
    station,
  });
}

/** 班次運行中走軌道，其餘依任務停入整備／停車／充電格 */
function getVehiclePublishMotion(vehicleId, elapsedMs, simStartMs, options = {}) {
  const trackMotion = getVehicleMotion(vehicleId, elapsedMs, simStartMs, options);
  if (trackMotion) {
    return {
      ...trackMotion,
      fleet_task: 'shift_run',
      yard_slot_id: null,
    };
  }
  return getVehicleYardMotion(vehicleId);
}

function getVehiclesInYardKind(kind) {
  if (!fleetBatteryState) return [];
  return VEHICLE_POOL.filter((id) => fleetBatteryState.vehicles[id].yardSlot?.kind === kind);
}

function tripCode(direction, date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${direction}${hh}${mm}`;
}

/** 已排班、尚未上場：仍在 P1–P4 臨停（供訂單／SQL 推算班次，不作地圖座標） */
function getScheduledSlotPendingInfo(vehicleId, elapsedMs, simStartMs) {
  const slot = fleetBatteryState?.slots?.find((s) => s.vehicleId === vehicleId);
  if (!slot) return null;
  const offsetMs = slot.offsetMin * 60 * 1000;
  if (elapsedMs >= offsetMs) return null;
  const vehicle = fleetBatteryState?.vehicles?.[vehicleId];
  if (!vehicle || vehicle.status === 'on_field') return null;
  const downDepartMs = simStartMs + offsetMs;
  const remainMs = Math.max(0, offsetMs - elapsedMs);
  return {
    tripCode: tripCode('D', new Date(downDepartMs)),
    legDepartMs: downDepartMs,
    departEtaSeconds: Math.max(0, remainMs / 1000),
  };
}

/** @deprecated 待发車改在 P1–P4；保留供舊呼叫端，不再用於 MQTT 座標 */
function getVehiclePreDepartureMotion(vehicleId, elapsedMs, simStartMs) {
  const pending = getScheduledSlotPendingInfo(vehicleId, elapsedMs, simStartMs);
  if (!pending) return null;
  const yard = getVehicleYardMotion(vehicleId);
  if (!yard) return null;
  return {
    ...yard,
    ...pending,
    preDeparture: true,
    fleet_task: 'pre_departure',
    active: false,
    leg: 'down',
    progress: 0,
    directionLabel: '規則1·D線',
  };
}

function hasPassedSignalRef(signal, x, y, heading) {
  const tol = 0.5;
  if (heading === HEADING.WEST) return x < signal.x - tol;
  if (heading === HEADING.EAST) return x > signal.x + tol;
  if (heading === HEADING.SOUTH) return y > signal.y + tol;
  if (heading === HEADING.NORTH) return y < signal.y - tol;
  return false;
}

function signalLampPhaseForVehicle(signal, timeline, localMs) {
  let cursor = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    const ev = timeline[i];
    if (ev.type !== 'signal_wait' || ev.station !== signal.id) {
      cursor += ev.durationMs;
      continue;
    }

    const waitStart = cursor;
    const waitEnd = cursor + ev.durationMs;
    if (localMs >= waitStart && localMs < waitEnd) {
      return 'red';
    }

    const after = timeline[i + 1];
    if (after?.type === 'travel' && localMs >= waitEnd) {
      const travelEnd = waitEnd + after.durationMs;
      if (localMs <= travelEnd) {
        const travelLocal = Math.min(after.durationMs, localMs - waitEnd);
        const t = after.durationMs > 0 ? travelLocal / after.durationMs : 1;
        const x = lerp(after.x0, after.x1, t);
        const y = lerp(after.y0, after.y1, t);
        if (!hasPassedSignalRef(signal, x, y, after.heading)) {
          return 'green';
        }
      }
    }
    return 'red';
  }
  return 'red';
}

function getVehicleLegTimeline(localMs) {
  if (USE_PLANNED_MAP_ROUTES) {
    const hit = resolvePlannedRouteLegAtLocal(localMs);
    if (hit) {
      return {
        timeline: hit.plan.timeline,
        legLocal: hit.legLocal,
        plannedPlan: hit.plan,
      };
    }
  }
  if (localMs < LEG_DURATION_MS) {
    return { timeline: ROUTE_TIMELINE_DOWN, legLocal: localMs };
  }
  return {
    timeline: ROUTE_TIMELINE_UP,
    legLocal: localMs - LEG_DURATION_MS,
  };
}

/** 依全車隊模擬進度決定各號誌燈色（預設紅燈；停等 5s 後綠燈；通過後恢復紅燈） */
function computeSignalLamps(elapsedMs, _simStartMs) {
  const lamps = new Map();
  for (const signal of T3_SIGNAL_REGISTRY) {
    lamps.set(signal.entityId, 'red');
  }

  for (const vehicle of getActiveFleet()) {
    const offsetMs = vehicle.offsetMin * 60 * 1000;
    if (elapsedMs < offsetMs) continue;

    const local = (elapsedMs - offsetMs) % CYCLE_MS;
    const { timeline, legLocal } = getVehicleLegTimeline(local);

    for (const signal of T3_SIGNAL_REGISTRY) {
      const phase = signalLampPhaseForVehicle(signal, timeline, legLocal);
      if (phase === 'green') {
        lamps.set(signal.entityId, 'green');
      }
    }
  }

  return lamps;
}

function getVehicleMotion(vehicleId, elapsedMs, simStartMs, options = {}) {
  const vehicle = getActiveFleet().find((v) => v.id === vehicleId);
  if (!vehicle) return null;

  const offsetMs = vehicle.offsetMin * 60 * 1000;
  if (elapsedMs < offsetMs) return null;
  if (!options.managed && elapsedMs > 60 * 60 * 1000) return null;

  const cycleMs = CYCLE_MS;
  const local = (elapsedMs - offsetMs) % cycleMs;
  const cycleIndex = Math.floor((elapsedMs - offsetMs) / cycleMs);

  if (USE_PLANNED_MAP_ROUTES) {
    const hit = resolvePlannedRouteLegAtLocal(local);
    if (!hit) return null;
    const { plan, planIndex, legLocal } = hit;
    const progress = plan.durationMs > 0 ? legLocal / plan.durationMs : 0;
    let legCursor = 0;
    for (let i = 0; i < planIndex; i++) {
      legCursor += PLANNED_ROUTE_PLAN[i].durationMs;
    }
    const legDepartMs = simStartMs + offsetMs + cycleIndex * cycleMs + legCursor;
    const departDate = new Date(legDepartMs);
    const directionLetter = planIndex % 2 === 0 ? 'D' : 'U';
    const pos = motionWithDefaultLights(
      sampleTimeline(plan.timeline, legLocal, { trackFamily: plan.trackFamily }),
    );
    return {
      active: true,
      leg: `planned-${planIndex}`,
      progress,
      tripCode: tripCode(directionLetter, departDate),
      plannedRouteId: plan.routeId,
      plannedRouteName: plan.displayName,
      plannedStationIds: plan.stationIds,
      plannedLegDurationMs: plan.durationMs,
      cycleIndex,
      legDepartMs,
      downDepartMs: legDepartMs,
      directionLabel: plan.displayName,
      ...pos,
    };
  }

  const downDepartMs = simStartMs + offsetMs + cycleIndex * cycleMs;
  const upDepartMs = downDepartMs + LEG_DURATION_MS;

  if (local < LEG_DURATION_MS) {
    const progress = local / LEG_DURATION_MS;
    const pos = motionWithDefaultLights(
      sampleTimeline(ROUTE_TIMELINE_DOWN, local, { trackFamily: 'D' }),
    );
    const departDate = new Date(downDepartMs);
    return {
      active: true,
      leg: 'down',
      progress,
      tripCode: tripCode('D', departDate),
      cycleIndex,
      legDepartMs: downDepartMs,
      downDepartMs,
      upDepartMs,
      directionLabel: '規則1·D線',
      ...pos,
    };
  }

  const upLocal = local - LEG_DURATION_MS;
  const progress = upLocal / LEG_DURATION_MS;
  const pos = motionWithDefaultLights(
    sampleTimeline(ROUTE_TIMELINE_UP, upLocal, { trackFamily: 'U' }),
  );
  const departDate = new Date(upDepartMs);
  return {
    active: true,
    leg: 'up',
    progress,
    tripCode: tripCode('U', departDate),
    cycleIndex,
    legDepartMs: upDepartMs,
    downDepartMs,
    upDepartMs,
    directionLabel: '規則2·U線',
    ...pos,
  };
}

/** 營運任務協議 current_leg：target_station_id / distance_to_target_m / eta_seconds */
const MAINLINE_LEG_MILESTONES = {
  T3_ARR: 0.35,
  T3_DEP: 0.68,
  TERM_ARR: 0.88,
};
/** 班次卡 route-progress 站點錨點（與 route_stations.remain_pct 一致） */
const MAINLINE_T3_BAR_PCT = 45;
const MAINLINE_SEGMENT_DIST_M = {
  TO_MID: 820,
  TO_TERM: 640,
};

/** 軌道 motion.progress (0–1) → 班次卡橫條 0–100（與圖台軌跡同一進度來源） */
function mainlineRouteProgressPercent(progressRaw) {
  const p = Math.max(0, Math.min(1, Number(progressRaw) || 0));
  const { T3_ARR, T3_DEP, TERM_ARR } = MAINLINE_LEG_MILESTONES;
  if (p >= TERM_ARR) return 100;
  if (p >= T3_DEP) {
    const span = TERM_ARR - T3_DEP;
    const t = span > 0 ? (p - T3_DEP) / span : 1;
    return Math.round(MAINLINE_T3_BAR_PCT + t * (100 - MAINLINE_T3_BAR_PCT));
  }
  if (p >= T3_ARR) return MAINLINE_T3_BAR_PCT;
  if (T3_ARR <= 0) return 0;
  return Math.round((p / T3_ARR) * MAINLINE_T3_BAR_PCT);
}

function fractionalEtaSeconds(remainFrac, legDurationSec) {
  return Math.max(0, Math.round(remainFrac * legDurationSec * 10) / 10);
}

function buildPreDepartureCurrentLeg(tripCode, departEtaSeconds) {
  const eta = Math.max(0, Math.round(Number(departEtaSeconds) * 10) / 10);
  const isUp = String(tripCode ?? '').trim().toUpperCase().startsWith('U');
  const mid = isUp ? 'station_4' : 'station_3';
  return {
    target_station_id: mid,
    distance_to_target_m: 0,
    eta_seconds: eta,
    leg_eta_max: Math.max(eta, 1),
  };
}

/** 地圖路線清單：依站序與進度推算 current_leg */
function buildPlannedRouteCurrentLeg(stationIds, progressRaw, legDurationSec) {
  const progress = Math.max(0, Math.min(1, Number(progressRaw) || 0));
  const ids = (stationIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (ids.length < 2) {
    return {
      target_station_id: ids[0] ?? '',
      distance_to_target_m: 0,
      eta_seconds: 0,
      leg_eta_max: 1,
    };
  }
  const segCount = ids.length - 1;
  const segWidth = 1 / segCount;
  const segIndex = Math.min(segCount - 1, Math.floor(progress / segWidth));
  const targetId = ids[segIndex + 1];
  const segStart = segIndex * segWidth;
  const segProgress = segWidth > 0 ? (progress - segStart) / segWidth : 1;
  const remainFrac = Math.max(0, 1 - segProgress);
  const segDurationSec = legDurationSec / segCount;
  const eta = fractionalEtaSeconds(remainFrac, segDurationSec);
  return {
    target_station_id: targetId,
    distance_to_target_m:
      eta > 0 ? Math.max(0, Number((remainFrac * 140).toFixed(1))) : 0,
    eta_seconds: eta,
    leg_eta_max: Math.max(eta, 1),
  };
}

/** 營運任務協議 current_leg：eta_seconds 永遠是到 target_station_id（下一站）剩餘秒數，非整條路線 */
function buildMainlineCurrentLeg(tripCode, progressRaw) {
  const progress = Math.max(0, Math.min(1, Number(progressRaw) || 0));
  const legDurationSec = LEG_DURATION_MS / 1000;
  const isUp = String(tripCode ?? '').trim().toUpperCase().startsWith('U');
  const mid = isUp ? 'station_4' : 'station_3';
  const dest = isUp ? 'station_1' : 'station_5';
  const m = MAINLINE_LEG_MILESTONES;

  const legEtaToMid = Math.round(m.T3_ARR * legDurationSec);
  const legEtaToTerm = Math.round((m.TERM_ARR - m.T3_DEP) * legDurationSec);

  if (progress >= m.TERM_ARR) {
    return {
      target_station_id: dest,
      distance_to_target_m: 0,
      eta_seconds: 0,
      leg_eta_max: legEtaToTerm,
    };
  }
  if (progress >= m.T3_DEP) {
    const remainFrac = m.TERM_ARR - progress;
    const eta = fractionalEtaSeconds(remainFrac, legDurationSec);
    const dist = eta > 0
      ? Math.max(0, Number(((remainFrac / (m.TERM_ARR - m.T3_DEP)) * MAINLINE_SEGMENT_DIST_M.TO_TERM).toFixed(1)))
      : 0;
    return {
      target_station_id: dest,
      distance_to_target_m: dist,
      eta_seconds: eta,
      leg_eta_max: legEtaToTerm,
    };
  }
  if (progress >= m.T3_ARR) {
    return {
      target_station_id: mid,
      distance_to_target_m: 0,
      eta_seconds: 0,
      leg_eta_max: legEtaToMid,
    };
  }
  const remainFrac = m.T3_ARR - progress;
  const eta = fractionalEtaSeconds(remainFrac, legDurationSec);
  const dist = eta > 0
    ? Math.max(0, Number(((remainFrac / m.T3_ARR) * MAINLINE_SEGMENT_DIST_M.TO_MID).toFixed(1)))
    : 0;
  return {
    target_station_id: mid,
    distance_to_target_m: dist,
    eta_seconds: eta,
    leg_eta_max: legEtaToMid,
  };
}

const motionExports = {
  VEHICLE_POOL,
  ACTIVE_SLOT_VEHICLE_IDS,
  ACTIVE_SLOT_COUNT,
  SLOT_OFFSETS_MIN,
  getActiveFleet,
  getFleet,
  resetFleetBatteryState,
  tickFleetBatteryState,
  getVehicleBattery,
  getVehicleFleetStatus,
  TRACK,
  MAP_REF_FIELD_SEGMENTS,
  ROUTE_SEG_DOWN,
  ROUTE_SEG_UP,
  ROUTE_TIMELINE_DOWN,
  ROUTE_TIMELINE_UP,
  classifyT3FieldTrack,
  resolveT3TrackCode,
  motionTrackCode,
  getVehicleMotion,
  getVehiclePreDepartureMotion,
  getScheduledSlotPendingInfo,
  getVehicleYardMotion,
  getVehiclePublishMotion,
  getVehicleFleetTask,
  getVehiclesInYardKind,
  getYardSlotCatalog,
  loadYardSlotCatalog,
  DEFAULT_MOTION_LIGHTS,
  interpolateTimedRoute,
  sampleTimeline,
  LEG_DURATION_MS,
  CYCLE_MS,
  STAGGER_MS,
  SEG1_FRAC,
  SEG2_FRAC,
  SEG3_FRAC,
  DOCKING_DWELL_MS,
  STOP_SETTLE_MS,
  DOOR_SYNC_OPEN_MS,
  PSD_OPEN_MS,
  PSD_CLOSE_MS,
  STATION_DWELL_MS,
  DOOR_OPEN_MS,
  DOOR_CLOSE_MS,
  psdOpenPercentAtDwellMs,
  T3_DOCKING_STOPS,
  T3_MAIN_MAP_PATH,
  printDockingStopsAudit,
  resolveDockStop,
  T3_SIGNAL_REGISTRY,
  DISPATCH_MS,
  TURN_MS,
  TURN_INNER_RADIUS_M,
  TURN_START_SEGMENT_FRAC,
  TURN_EXIT_SEGMENT_FRAC,
  TURN_EXIT_TRACK,
  resolveInnerTurnArc,
  turnApproachStart,
  SIGNAL_WAIT_MS,
  getT3SignalStops: () => T3_SIGNAL_STOPS,
  computeSignalLamps,
  signalsOnTravelSegment,
  MAINLINE_STATION_IDS_BY_LEG,
  MAP_PLANNED_ROUTES,
  PLANNED_ROUTE_PLAN,
  USE_PLANNED_MAP_ROUTES,
  buildMainlineCurrentLeg,
  buildPlannedRouteCurrentLeg,
  mainlineRouteProgressPercent,
  MAINLINE_LEG_MILESTONES,
  buildPreDepartureCurrentLeg,
};

Object.defineProperty(motionExports, 'YARD_CHARGING', {
  enumerable: true,
  get: yardCharging,
});
Object.defineProperty(motionExports, 'YARD_PARKING', {
  enumerable: true,
  get: yardParking,
});
Object.defineProperty(motionExports, 'YARD_MAINT', {
  enumerable: true,
  get: yardMaint,
});

module.exports = motionExports;
