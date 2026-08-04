import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { MAP_FILE_SCHEMA_VERSION, MAP_FILE_SCHEMA_VERSION_V1 } from '../types/mapFile'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildMapFileV2,
  facilityToMapEntry,
  migrateMisclassifiedSmartPoleEntry,
  parseMapFileJson,
} from './mapFileJson'

function baseFacility(
  partial: Partial<FacilityObject> & Pick<FacilityObject, 'id' | 'type' | 'name'>,
): FacilityObject {
  const common = {
    customName: partial.customName ?? partial.id,
    position: { x: 10, y: 20 },
    areaPosition: { x: 40, y: 50 },
    areaSizePx: { w: 80, h: 40 },
    areaLayoutAnchor: { wPx: 1840, hPx: 1000 },
    rotation: 0,
    parameters: {},
    ...partial,
  }
  if (partial.type === 'Slot') {
    return {
      ...common,
      type: 'Slot',
      name: 'Parking',
      slotOccupancy: 'Vacant',
      slotEquipmentState: 'Idle',
      ...partial,
    } as FacilityObject
  }
  if (partial.type === 'Geofence') {
    return {
      ...common,
      type: 'Geofence',
      name: 'Geofence',
      currentState: 'Normal',
      ...partial,
    } as FacilityObject
  }
  return {
    ...common,
    currentState: 'Normal',
    ...partial,
  } as FacilityObject
}

describe('mapFileJson', () => {
  it('round-trips map description on parse → build', () => {
    const doc = buildMapFileV2(
      'map-1',
      '測試地圖',
      DEFAULT_MAP_PIXEL_SIZE,
      [createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)],
      { description: '  這是說明文字  ', version: 'v1.2.3' },
    )
    assert.equal(doc.description, '這是說明文字')
    const parsed = parseMapFileJson(doc)
    assert.equal(parsed.description, '這是說明文字')
    const rebuilt = buildMapFileV2(
      parsed.mapId,
      parsed.displayName,
      parsed.pixelSize,
      parsed.areas,
      { description: parsed.description, version: parsed.version },
    )
    assert.equal(rebuilt.description, '這是說明文字')
    assert.equal(
      JSON.parse(JSON.stringify(rebuilt)).description,
      '這是說明文字',
    )
  })

  it('omits blank description and reads v1 description', () => {
    const blank = buildMapFileV2(
      'map-blank',
      '空白說明',
      DEFAULT_MAP_PIXEL_SIZE,
      [createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)],
      { description: '   ' },
    )
    assert.equal('description' in blank, false)

    const v1 = {
      schemaVersion: MAP_FILE_SCHEMA_VERSION_V1,
      mapId: 'legacy',
      displayName: '舊圖',
      description: 'v1 說明',
      coordinateSystem: {
        extentMeters: { width: 100, height: 80 },
      },
      facilities: [],
    }
    const parsed = parseMapFileJson(v1)
    assert.equal(parsed.description, 'v1 說明')
  })

  it('round-trips facility types and key parameters', () => {
    const facilities: FacilityObject[] = [
      baseFacility({
        id: 'slot-1',
        type: 'Slot',
        name: 'Parking',
        slotOccupancy: 'Occupied',
        slotEquipmentState: 'Charging',
        slotOccupancyEnabled: { Vacant: true, Occupied: false },
        parameters: { remarks: '整備格備註' },
      }),
      baseFacility({
        id: 'fac-1',
        type: 'Facility',
        name: 'FacilityArea',
        currentState: 'Warning',
        parameters: {
          purpose: '維修區',
          defaultFillColor: '#334455',
          remarks: '設施備註',
        },
      }),
      baseFacility({
        id: 'gf-1',
        type: 'Geofence',
        name: 'Geofence',
        parameters: {
          verticesMeters: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 8 },
          ],
          fillOpacity: 0.35,
          fillEnabled: true,
          fillColor: '#22d3ee',
          strokeColor: '#22d3ee',
          labels: [
            {
              id: 'lbl-1',
              text: '禁行',
              x: 5,
              y: 4,
              fontSizePx: 14,
              labelBoxWidthPx: 60,
            },
          ],
        },
      }),
      baseFacility({
        id: 'psd-1',
        type: 'PSD',
        name: 'Gate',
        currentState: 'Closed',
        parameters: { openPercent: 0, alarm: false, mqttOpenPercentKey: 'op' },
      }),
      baseFacility({
        id: 'sig-1',
        type: 'Signal',
        name: 'Light',
        currentState: 'Normal',
        parameters: { mountDirection: 'up', defaultLamp: 'green' },
      }),
      baseFacility({
        id: 'trk-1',
        type: 'Track',
        name: 'Rail',
        currentState: 'Idle',
        parameters: {
          segmentId: 'R01',
          defaultFillColor: '#1a2233',
          trackCornerRadiusMeters: { tl: 0.1, tr: 0, br: 0, bl: 0.1 },
        },
      }),
      baseFacility({
        id: 'pole-1',
        type: 'Pole',
        name: 'SmartPole',
        currentState: 'Normal',
        parameters: { refFieldXM: 12.5, refFieldYM: 33 },
      }),
      baseFacility({
        id: 'dock-1',
        type: 'DockingPoint',
        name: 'DockingPoint',
        currentState: 'Normal',
        parameters: {
          stationId: 'ST-A',
          stationName: 'A 站',
        },
      }),
      baseFacility({
        id: 'wp-1',
        type: 'Waypoint',
        name: 'Waypoint',
        currentState: 'Normal',
        parameters: { waypointCode: 'WP-01' },
      }),
      baseFacility({
        id: 'road-1',
        type: 'RoadLine',
        name: 'RoadLine',
        currentState: 'Normal',
        parameters: {
          roadLineStyle: 'solid',
          roadLineWidthPx: 4,
          roadLineColor: '#888888',
          pinToTop: true,
        },
      }),
    ]

    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      facilities,
    }
    const doc = buildMapFileV2('map-fac', '元件往返', DEFAULT_MAP_PIXEL_SIZE, [area], {
      description: '含全部元件型別',
      routes: [
        {
          routeId: 'route-1',
          displayName: '測試路線',
          stationIds: ['ST-A'],
          avgTravelTimeSeconds: 120,
          minTravelTimeSeconds: 90,
        },
      ],
      routeGroups: [{ groupId: 'g1', displayName: '群組一', routeIds: ['route-1'] }],
      pointTopology: {
        ...emptyPointTopology(),
        nodes: [
          {
            id: 'dock-1',
            kind: 'docking',
            label: 'A',
            stationId: 'ST-A',
            x: 100,
            y: 100,
            color: '#112233',
          },
        ],
        edges: [],
      },
    })

    assert.equal(doc.schemaVersion, MAP_FILE_SCHEMA_VERSION)
    assert.equal(doc.areas[0]!.facilities.length, facilities.length)

    const parsed = parseMapFileJson(JSON.parse(JSON.stringify(doc)))
    assert.equal(parsed.description, '含全部元件型別')
    assert.equal(parsed.routes.length, 1)
    assert.equal(parsed.routeGroups.length, 1)
    assert.equal(parsed.pointTopology.nodes.length, 1)

    const byId = new Map(
      parsed.areas[0]!.facilities.map((f) => [f.id, f] as const),
    )

    const slot = byId.get('slot-1')
    assert.equal(slot?.type, 'Slot')
    if (slot?.type === 'Slot') {
      assert.equal(slot.slotOccupancy, 'Occupied')
      assert.equal(slot.slotEquipmentState, 'Charging')
      assert.equal(slot.slotOccupancyEnabled?.Occupied, false)
      assert.equal(slot.parameters?.remarks, '整備格備註')
    }

    assert.equal(byId.get('fac-1')?.parameters?.purpose, '維修區')
    assert.equal(byId.get('gf-1')?.parameters?.fillOpacity, 0.35)
    assert.deepEqual(
      (byId.get('gf-1')?.parameters?.labels as Array<{ text: string }>)?.[0]?.text,
      '禁行',
    )
    assert.equal(byId.get('psd-1')?.parameters?.mqttOpenPercentKey, 'op')
    assert.equal(byId.get('sig-1')?.parameters?.mountDirection, 'up')
    assert.equal(byId.get('trk-1')?.parameters?.segmentId, 'R01')
    assert.equal(byId.get('pole-1')?.parameters?.refFieldXM, 12.5)
    assert.equal(byId.get('dock-1')?.parameters?.stationId, 'ST-A')
    assert.equal(byId.get('wp-1')?.parameters?.waypointCode, 'WP-01')
    assert.equal(byId.get('road-1')?.parameters?.pinToTop, true)

    // facilityToMapEntry 也應保留 parameters 鍵
    const trackEntry = facilityToMapEntry(byId.get('trk-1')!)
    assert.equal(trackEntry.parameters?.segmentId, 'R01')
  })

  it('round-trips TrackCrossover portals, facilityDockingPoint, and topology kinds', () => {
    const facilities = [
      baseFacility({
        id: 'fac-p1',
        type: 'Facility',
        name: 'FacilityArea',
        currentState: 'Normal',
        parameters: {
          purpose: '停車格',
          refFieldXMinM: 0,
          refFieldXMaxM: 20,
          refFieldYMinM: 0,
          refFieldYMaxM: 10,
          facilityDockingPoint: { xM: 5, yM: 4 },
        },
      }),
      baseFacility({
        id: 'xo-3',
        type: 'TrackCrossover',
        name: 'TrackCrossover',
        currentState: 'Normal',
        parameters: {
          trackCrossoverColor: '#94a3b8',
          trackCrossoverStrokePx: 12,
          trackCrossoverPortals: {
            a: {
              xM: 40,
              yM: 20,
              attachedTrackId: 'trk-u',
              waypointCode: 'xo_3_a',
              alias: '下行轉S2W正線終點',
            },
            b: {
              xM: 40,
              yM: 40,
              attachedTrackId: 'trk-d',
              waypointCode: 'xo_3_b',
              alias: '下行轉S2W正線起點',
            },
          },
        },
      }),
      baseFacility({
        id: 'dock-2',
        type: 'DockingPoint',
        name: 'DockingPoint',
        customName: 'N2W下行',
        currentState: 'Normal',
        parameters: {
          stationId: 'station_2',
          refFieldXM: 100,
          refFieldYM: 50,
        },
      }),
    ]

    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      facilities,
    }

    const doc = buildMapFileV2('map-xo', '渡線與拓撲', DEFAULT_MAP_PIXEL_SIZE, [area], {
      routes: [
        {
          routeId: 'route-down',
          displayName: '下行',
          stationIds: ['fdock:fac-p1', 'station_2', 'xo_3_b'],
          avgTravelTimeSeconds: 180,
          minTravelTimeSeconds: 150,
        },
      ],
      routeGroups: [
        { groupId: 'g-down', displayName: '下行路線群組', routeIds: ['route-down'] },
      ],
      pointTopology: {
        ...emptyPointTopology(),
        nodes: [
          {
            id: 'fdock:fac-p1',
            kind: 'facility-docking',
            label: 'P1停',
            x: 10,
            y: 20,
            color: '#e59a2d',
          },
          {
            id: 'dock-2',
            kind: 'docking',
            label: 'N2W下行',
            stationId: 'station_2',
            x: 30,
            y: 40,
            color: '#22c55e',
          },
          {
            id: 'xowp:xo-3:b',
            kind: 'crossover-waypoint',
            label: '下行轉S2W正線起點',
            stationId: 'xo_3_b',
            x: 50,
            y: 60,
            color: '#2a9fbf',
          },
        ],
        edges: [
          {
            id: 'e1',
            fromNodeId: 'fdock:fac-p1',
            toNodeId: 'dock-2',
            minTravelTimeSeconds: 10,
            avgTravelTimeSeconds: 10,
            distanceMeters: 100,
            curveOffsetX: 12,
            curveOffsetY: -4,
          },
          {
            id: 'e2',
            fromNodeId: 'dock-2',
            toNodeId: 'xowp:xo-3:b',
            minTravelTimeSeconds: 140,
            avgTravelTimeSeconds: 170,
            distanceMeters: 810,
          },
        ],
      },
    })

    const json = JSON.parse(JSON.stringify(doc)) as unknown
    const parsed = parseMapFileJson(json)
    const rebuilt = buildMapFileV2(
      parsed.mapId,
      parsed.displayName,
      parsed.pixelSize,
      parsed.areas,
      {
        routes: parsed.routes,
        routeGroups: parsed.routeGroups,
        pointTopology: parsed.pointTopology,
      },
    )

    const xo = parsed.areas[0]!.facilities.find((f) => f.id === 'xo-3')
    assert.equal(xo?.type, 'TrackCrossover')
    const portals = xo?.parameters?.trackCrossoverPortals as {
      a: { waypointCode: string; attachedTrackId: string; alias?: string }
      b: { waypointCode: string; attachedTrackId: string; alias?: string }
    }
    assert.equal(portals.a.waypointCode, 'xo_3_a')
    assert.equal(portals.b.waypointCode, 'xo_3_b')
    assert.equal(portals.a.attachedTrackId, 'trk-u')
    assert.equal(portals.b.attachedTrackId, 'trk-d')
    assert.equal(portals.b.alias, '下行轉S2W正線起點')

    const fac = parsed.areas[0]!.facilities.find((f) => f.id === 'fac-p1')
    assert.deepEqual(fac?.parameters?.facilityDockingPoint, { xM: 5, yM: 4 })

    assert.equal(parsed.routes[0]?.stationIds.length, 3)
    assert.equal(parsed.routeGroups[0]?.groupId, 'g-down')
    assert.equal(parsed.pointTopology.nodes.length, 3)
    assert.equal(parsed.pointTopology.edges.length, 2)
    const edge1 = parsed.pointTopology.edges.find((e) => e.id === 'e1')
    assert.equal(edge1?.distanceMeters, 100)
    assert.equal(edge1?.curveOffsetX, 12)
    assert.equal(edge1?.curveOffsetY, -4)

    const rebuiltXo = rebuilt.areas[0]!.facilities.find((f) => f.id === 'xo-3')
    assert.deepEqual(
      rebuiltXo?.parameters?.trackCrossoverPortals,
      xo?.parameters?.trackCrossoverPortals,
    )
    assert.equal(rebuilt.pointTopology?.edges.length, 2)
  })

  it('round-trips visibleRouteIds and does not force all visible when missing', () => {
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    const routes = [
      {
        routeId: 'route-a',
        displayName: 'A',
        stationIds: ['s1'],
      },
      {
        routeId: 'route-b',
        displayName: 'B',
        stationIds: ['s2'],
      },
    ]
    const doc = buildMapFileV2('map-vis', '可視', DEFAULT_MAP_PIXEL_SIZE, [area], {
      routes,
      visibleRouteIds: ['route-b', 'route-missing', 'route-b'],
    })
    assert.deepEqual(doc.visibleRouteIds, ['route-b'])

    const parsed = parseMapFileJson(JSON.parse(JSON.stringify(doc)))
    assert.deepEqual(parsed.visibleRouteIds, ['route-b'])

    const legacy = buildMapFileV2('map-legacy', '舊', DEFAULT_MAP_PIXEL_SIZE, [area], {
      routes,
    })
    // build 一律寫入陣列；模擬缺欄舊檔
    const { visibleRouteIds: _drop, ...withoutVis } = legacy
    const parsedLegacy = parseMapFileJson(withoutVis)
    assert.deepEqual(parsedLegacy.visibleRouteIds, [])
  })

  it('migrates Facility+purpose 智慧桿 to Pole equipment', () => {
    const migrated = migrateMisclassifiedSmartPoleEntry({
      id: '052',
      type: 'Facility',
      name: 'FacilityArea',
      customName: 'R04',
      positionMeters: { x: 1, y: 2 },
      rotationDeg: 0,
      areaSizePx: { w: 100, h: 60 },
      parameters: {
        purpose: '智慧桿',
        customIconUrl: 'facility/smart_pole_enable.png',
        refFieldXMinM: 0,
        refFieldXMaxM: 0,
        refFieldYMinM: 0,
        refFieldYMaxM: 0,
      },
    })
    assert.equal(migrated.type, 'Pole')
    assert.equal(migrated.name, 'SmartPole')
    assert.equal(migrated.parameters?.purpose, undefined)
    assert.equal(migrated.parameters?.defaultFillColor, 'transparent')
    assert.equal(migrated.parameters?.customIconUrl, 'facility/smart_pole_enable.png')
    assert.deepEqual(migrated.areaSizePx, { w: 30, h: 105 })
  })
})
