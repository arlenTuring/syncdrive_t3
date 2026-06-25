/**
 * Merge T3 docking points into frontend/public/maps/t3-main-version.json.
 *
 * - refFieldXM/refFieldYM + dockingLeg/dockingStation are authoritative for simulation
 * - customName / stationName default empty (no display label)
 * - Canvas layout preserved when an entry already exists
 */
const fs = require('fs');
const path = require('path');
const {
  ensureDockingPointParams,
  collectOperationNodesFromMap,
  DOCKING_POINT_NODE_ID_KEY,
  DOCKING_POINT_NODE_ROLE_KEY,
} = require('./map-operation-nodes');

const MAP_PATH = path.join(__dirname, '../../frontend/public/maps/t3-main-version.json');

function domainWidthM(domain) {
  return Math.max(0.001, domain.xMaxM - domain.xMinM);
}

function domainHeightM(domain) {
  return Math.max(0.001, domain.yMaxM - domain.yMinM);
}

function meterToAreaLocalPx(xM, yM, domain, layout) {
  const pxPerMeterX = layout.wPx / domainWidthM(domain);
  const pxPerMeterY = layout.hPx / domainHeightM(domain);
  return {
    x: (xM - domain.xMinM) * pxPerMeterX,
    y: (yM - domain.yMinM) * pxPerMeterY,
  };
}

function lerp(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

/** @type {Array<{ areaId: string, id: string, dockingLeg: 'down'|'up', dockingStation: 'N2W'|'T3'|'S2W', refFieldXM: number, refFieldYM: number, layout: (area: object)=>{positionMeters:{x:number,y:number}} }>} */
const DOCKING_SPECS = [
  {
    areaId: 'area-a',
    id: '174',
    dockingLeg: 'up',
    dockingStation: 'N2W',
    refFieldXM: 810,
    refFieldYM: 105.25,
    layout: () => ({ positionMeters: { x: 810, y: 369.6651035953235 } }),
  },
  {
    areaId: 'area-a',
    id: '175',
    dockingLeg: 'down',
    dockingStation: 'N2W',
    refFieldXM: 840,
    refFieldYM: 101.75,
    layout: () => ({ positionMeters: { x: 840, y: 383.33508288638507 } }),
  },
  {
    areaId: 'area-d',
    id: '176',
    dockingLeg: 'down',
    dockingStation: 'T3',
    refFieldXM: 101.75,
    refFieldYM: 170,
    layout: () => ({
      positionMeters: { x: 60.60400687670052, y: 246.01457855883186 },
    }),
  },
  {
    areaId: 'area-d',
    id: '177',
    dockingLeg: 'up',
    dockingStation: 'T3',
    refFieldXM: 105,
    refFieldYM: 230,
    layout: (area) => {
      const u17 = area.facilities.find((f) => f.customName === 'U17');
      const u19 = area.facilities.find((f) => f.customName === 'U19');
      const yMin = u17?.parameters?.refFieldYMinM ?? 107;
      const yMax = u19?.parameters?.refFieldYMaxM ?? 300;
      const posYMin = u17?.positionMeters?.y ?? 289.13777819155905;
      const posYMax = u19?.positionMeters?.y ?? 218.93512641225183;
      return {
        positionMeters: {
          x: u17?.positionMeters?.x ?? 68.3983745345262,
          y: lerp(230, yMin, yMax, posYMin, posYMax),
        },
      };
    },
  },
  {
    areaId: 'area-g',
    id: '178',
    dockingLeg: 'up',
    dockingStation: 'S2W',
    refFieldXM: 810,
    refFieldYM: 305.25,
    layout: () => ({ positionMeters: { x: 810, y: 57.46483087311962 } }),
  },
  {
    areaId: 'area-g',
    id: '179',
    dockingLeg: 'down',
    dockingStation: 'S2W',
    refFieldXM: 840,
    refFieldYM: 301.75,
    layout: () => ({ positionMeters: { x: 840, y: 70.3771658997137 } }),
  },
];

function buildDockingFacility(spec, area, existing, existingIds, canonicalByStationRole) {
  const positionMeters =
    existing?.positionMeters ?? spec.layout(area).positionMeters;
  const areaPosition =
    existing?.areaPosition ??
    meterToAreaLocalPx(
      positionMeters.x,
      positionMeters.y,
      area.domain,
      area.layout,
    );
  const areaSizePx =
    existing?.areaSizePx ??
    (() => {
      const pxPerMeterX = area.layout.wPx / domainWidthM(area.domain);
      const pxPerMeterY = area.layout.hPx / domainHeightM(area.domain);
      const sizeM = 4;
      return { w: sizeM * pxPerMeterX, h: sizeM * pxPerMeterY };
    })();

  return {
    id: spec.id,
    type: 'DockingPoint',
    name: 'DockingPoint',
    customName: '',
    positionMeters,
    areaPosition,
    areaLayoutAnchor: existing?.areaLayoutAnchor ?? {
      wPx: area.layout.wPx,
      hPx: area.layout.hPx,
    },
    areaSizePx,
    rotationDeg: existing?.rotationDeg ?? 0,
    parameters: ensureDockingPointParams(
      {
        ...(existing?.parameters ?? {}),
        [DOCKING_POINT_NODE_ID_KEY]: undefined,
        [DOCKING_POINT_NODE_ROLE_KEY]: undefined,
        iconMode: existing?.parameters?.iconMode ?? 'dot',
        dockingLeg: spec.dockingLeg,
        dockingStation: spec.dockingStation,
        refFieldXM: spec.refFieldXM,
        refFieldYM: spec.refFieldYM,
      },
      existingIds,
      canonicalByStationRole,
    ),
    currentState: existing?.currentState ?? 'Normal',
  };
}

function main() {
  const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const existingIds = new Set();
  const canonicalByStationRole = new Map();

  for (const spec of DOCKING_SPECS) {
    const area = map.areas.find((a) => a.id === spec.areaId);
    if (!area) throw new Error(`Area not found: ${spec.areaId}`);

    const existing = (area.facilities ?? []).find(
      (f) =>
        f.type === 'DockingPoint' &&
        (f.id === spec.id ||
          f.parameters?.dockingLeg === spec.dockingLeg &&
            f.parameters?.dockingStation === spec.dockingStation),
    );

    area.facilities = (area.facilities ?? []).filter(
      (f) =>
        !(
          f.type === 'DockingPoint' &&
          (f.id === spec.id ||
            (f.parameters?.dockingLeg === spec.dockingLeg &&
              f.parameters?.dockingStation === spec.dockingStation))
        ),
    );

    area.facilities.push(
      buildDockingFacility(spec, area, existing, existingIds, canonicalByStationRole),
    );
  }

  const registry = collectOperationNodesFromMap(map);
  map.updatedAt = new Date().toISOString();
  fs.writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  console.log(`Merged ${DOCKING_SPECS.length} docking points`);
  for (const node of registry.nodes) {
    console.log(`  ${node.stationName} → ${node.nodeId} @ (${node.xM}, ${node.yM})`);
  }
}

main();
