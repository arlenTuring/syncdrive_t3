import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { MAP_FILE_SCHEMA_VERSION, MAP_FILE_SCHEMA_VERSION_V1 } from '../types/mapFile'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildMapFileV2,
  facilityToMapEntry,
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
          dockingLeg: 'inbound',
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
})
