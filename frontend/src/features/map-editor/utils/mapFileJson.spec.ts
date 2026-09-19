import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { MAP_FILE_SCHEMA_VERSION, MAP_FILE_SCHEMA_VERSION_V1 } from '../types/mapFile'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildMapFileV2,
  facilityToMapEntry,
  migrateFacilityName,
  migrateMisclassifiedSmartPoleEntry,
  parseMapFileJson,
  recoverTrackNameFromParameters,
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

  it('facilityToMapEntry tolerates missing areaLayoutAnchor (TrackGen apply)', () => {
    const f = baseFacility({
      id: 'trk-no-anchor',
      type: 'Track',
      name: 'StraightTrack',
      areaLayoutAnchor: undefined,
    })
    delete (f as { areaLayoutAnchor?: unknown }).areaLayoutAnchor
    const entry = facilityToMapEntry(f)
    assert.equal(entry.id, 'trk-no-anchor')
    assert.equal(entry.areaLayoutAnchor, undefined)
    // Must not throw when building a full map document either
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    area.facilities = [f]
    const doc = buildMapFileV2('map-1', 'test', DEFAULT_MAP_PIXEL_SIZE, [area])
    assert.equal(doc.areas[0]?.facilities[0]?.id, 'trk-no-anchor')
  })

  it('round-trips RailCross portals, facilityDockingPoint, and topology kinds', () => {
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
        id: 'cross-3',
        type: 'Track',
        name: 'RailCross',
        currentState: 'Normal',
        parameters: {
          crossTrackPortals: {
            lt: {
              waypointCode: 'go_end',
              alias: '下行轉S2W正線終點',
              xM: 40,
              yM: 20,
            },
            rb: {
              waypointCode: 'go_start',
              alias: '下行轉S2W正線起點',
              xM: 40,
              yM: 40,
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

    const doc = buildMapFileV2('map-cross', '交叉軌道與拓撲', DEFAULT_MAP_PIXEL_SIZE, [area], {
      routes: [
        {
          routeId: 'route-down',
          displayName: '下行',
          stationIds: ['fdock:fac-p1', 'station_2', 'go_start'],
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
            id: 'xcwp:cross-3:rb',
            kind: 'cross-waypoint',
            label: '下行轉S2W正線起點',
            stationId: 'go_start',
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
            toNodeId: 'xcwp:cross-3:rb',
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

    const cross = parsed.areas[0]!.facilities.find((f) => f.id === 'cross-3')
    assert.equal(cross?.name, 'RailCross')
    const portals = cross?.parameters?.crossTrackPortals as {
      lt: { waypointCode: string; alias?: string }
      rb: { waypointCode: string; alias?: string }
    }
    assert.equal(portals.lt.waypointCode, 'go_end')
    assert.equal(portals.rb.waypointCode, 'go_start')
    assert.equal(portals.rb.alias, '下行轉S2W正線起點')

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

    const rebuiltCross = rebuilt.areas[0]!.facilities.find((f) => f.id === 'cross-3')
    assert.deepEqual(
      rebuiltCross?.parameters?.crossTrackPortals,
      cross?.parameters?.crossTrackPortals,
    )
    assert.equal(rebuilt.pointTopology?.edges.length, 2)
  })

  it('舊圖的虛擬渡線（TrackCrossover）讀不進來，錯誤訊息說明已移除', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      facilities: [
        baseFacility({
          id: 'xo-old',
          type: 'Track',
          name: 'Rail',
          currentState: 'Normal',
          parameters: {},
        }),
      ],
    }
    const doc = JSON.parse(
      JSON.stringify(buildMapFileV2('map-old', '舊圖', DEFAULT_MAP_PIXEL_SIZE, [area])),
    ) as { areas: Array<{ facilities: Array<Record<string, unknown>> }> }
    doc.areas[0]!.facilities[0]!.type = 'TrackCrossover'
    doc.areas[0]!.facilities[0]!.name = 'TrackCrossover'
    assert.throws(() => parseMapFileJson(doc), /虛擬渡線.*已移除/)
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

  it('round-trips route pathWaypoints for simulation path edit', () => {
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    const routes = [
      {
        routeId: 'route-path',
        displayName: '折點路線',
        stationIds: ['s1', 's2'],
        pathWaypoints: [
          { px: 10, py: 20, x: 1, y: 2, stationId: 's1' },
          { px: 50, py: 20 },
          { px: 50, py: 80, x: 5, y: 8, stationId: 's2' },
        ],
      },
    ]
    const doc = buildMapFileV2('map-pw', '折點', DEFAULT_MAP_PIXEL_SIZE, [area], {
      routes,
    })
    const parsed = parseMapFileJson(JSON.parse(JSON.stringify(doc)))
    assert.equal(parsed.routes[0]?.pathWaypoints?.length, 3)
    assert.equal(parsed.routes[0]?.pathWaypoints?.[1]?.px, 50)
    assert.equal(parsed.routes[0]?.pathWaypoints?.[0]?.stationId, 's1')
    assert.equal(parsed.routes[0]?.pathWaypoints?.[1]?.stationId, undefined)
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

  it('preserves special Track names on migrate (not forced to Rail)', () => {
    assert.equal(migrateFacilityName('Track', 'Rail'), 'Rail')
    assert.equal(migrateFacilityName('Track', 'RailCorner'), 'RailCorner')
    assert.equal(migrateFacilityName('Track', 'RailTaper'), 'RailTaper')
    assert.equal(migrateFacilityName('Track', 'RailSwitch'), 'RailSwitch')
    assert.equal(migrateFacilityName('Track', 'RailCross'), 'RailCross')
  })

  it('recovers Track name from shape parameters when wrongly stored as Rail', () => {
    assert.equal(
      recoverTrackNameFromParameters('Rail', { cornerTrack: { kind: 'se' } }),
      'RailCorner',
    )
    assert.equal(
      recoverTrackNameFromParameters('Rail', { taperTrack: { leftCut: 0.2 } }),
      'RailTaper',
    )
    assert.equal(
      recoverTrackNameFromParameters('Rail', { switchTrack: { arm: 1 } }),
      'RailSwitch',
    )
    assert.equal(
      recoverTrackNameFromParameters('Rail', { crossTrack: { arms: 4 } }),
      'RailCross',
    )
    assert.equal(
      recoverTrackNameFromParameters('Rail', { defaultFillColor: '#191F2F' }),
      'Rail',
    )
  })

  it('round-trips RailCorner / RailTaper names through map JSON', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      facilities: [
        baseFacility({
          id: 'c1',
          type: 'Track',
          name: 'RailCorner',
          customName: '8:2X-01',
          parameters: {
            cornerTrack: { kind: 'se', radiusM: 12 },
            defaultFillColor: '#2f4f4a',
          },
        }),
        baseFacility({
          id: 't1',
          type: 'Track',
          name: 'RailTaper',
          customName: '9:2X-04',
          parameters: {
            taperTrack: { leftCutRatio: 0.3, rightCutRatio: 0.3 },
            defaultFillColor: '#33435c',
          },
        }),
      ],
    }
    const doc = buildMapFileV2('map-shapes', '形狀', DEFAULT_MAP_PIXEL_SIZE, [area])
    const parsed = parseMapFileJson(JSON.parse(JSON.stringify(doc)))
    assert.equal(parsed.areas[0]?.facilities.find((f) => f.id === 'c1')?.name, 'RailCorner')
    assert.equal(parsed.areas[0]?.facilities.find((f) => f.id === 't1')?.name, 'RailTaper')

    // 模擬已被 bug 寫成 Rail、但幾何參數還在的舊檔
    const corrupted = JSON.parse(JSON.stringify(doc)) as {
      areas: Array<{ facilities: Array<{ id: string; name: string; parameters?: unknown }> }>
    }
    for (const f of corrupted.areas[0]!.facilities) {
      f.name = 'Rail'
    }
    const recovered = parseMapFileJson(corrupted)
    assert.equal(recovered.areas[0]?.facilities.find((f) => f.id === 'c1')?.name, 'RailCorner')
    assert.equal(recovered.areas[0]?.facilities.find((f) => f.id === 't1')?.name, 'RailTaper')
  })

  it('defaults missing creationMode to blank and keeps areas', () => {
    const doc = buildMapFileV2(
      'map-legacy',
      '舊圖',
      DEFAULT_MAP_PIXEL_SIZE,
      [createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)],
    )
    assert.equal(doc.creationMode, undefined)
    const parsed = parseMapFileJson(doc)
    assert.equal(parsed.creationMode, 'blank')
    assert.equal(parsed.areas.length, 1)
  })

  it('round-trips trackGen creationMode and allows empty areas', () => {
    const doc = buildMapFileV2(
      'map-hd',
      '高精',
      DEFAULT_MAP_PIXEL_SIZE,
      [],
      {
        creationMode: 'trackGen',
        basemaps: [
          {
            id: '1',
            customName: '高精地圖',
            layout: {
              xPx: 0,
              yPx: 0,
              wPx: DEFAULT_MAP_PIXEL_SIZE.width,
              hPx: DEFAULT_MAP_PIXEL_SIZE.height,
            },
            parameters: { componentKind: 'trackGenerator' },
          },
        ],
      },
    )
    assert.equal(doc.creationMode, 'trackGen')
    assert.equal(doc.areas.length, 0)
    assert.equal(doc.basemaps?.length, 1)
    const parsed = parseMapFileJson(JSON.parse(JSON.stringify(doc)))
    assert.equal(parsed.creationMode, 'trackGen')
    assert.equal(parsed.areas.length, 0)
    assert.equal(parsed.basemaps.length, 1)
    assert.equal(parsed.basemaps[0]?.parameters?.componentKind, 'trackGenerator')
  })
})
