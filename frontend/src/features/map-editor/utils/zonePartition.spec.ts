import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  absoluteToZoneLocal,
  applyEntranceLinksToAreaFacilities,
  availableZonePartitionsForEntrance,
  canBelongToParentZone,
  clampFacilityInsideParentZone,
  createFacilityAreaInsideZone,
  createZoneEntranceLink,
  createZoneEntranceLinkFromPartition,
  rematerializeZoneChildrenOntoZoneCanvas,
  sanitizeZoneParameters,
  syncZoneChildFieldFromPlacement,
  zoneLocalToAbsolute,
  ZONE_LOCAL_FIELD_KEY,
  PARENT_ZONE_ID_KEY,
  ZONE_ENTRANCE_LINKS_KEY,
  ZONE_PARTITION_ENTRANCE_ID_KEY,
} from './zonePartition'

describe('canBelongToParentZone', () => {
  it('allows only FacilityArea, not tracks, zones, or other facility names', () => {
    assert.equal(
      canBelongToParentZone({
        id: 'a',
        type: 'Facility',
        name: 'FacilityArea',
        customName: '',
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Normal',
      }),
      true,
    )
    assert.equal(
      canBelongToParentZone({
        id: 'cross',
        type: 'Track',
        name: 'RailCross',
        customName: '',
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Idle',
      }),
      false,
    )
    assert.equal(
      canBelongToParentZone({
        id: 'z',
        type: 'Facility',
        name: 'ZonePartition',
        customName: '',
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Normal',
      }),
      false,
    )
    assert.equal(
      canBelongToParentZone({
        id: 'e',
        type: 'Facility',
        name: 'ZoneEntrance',
        customName: '',
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Normal',
      }),
      false,
    )
    assert.equal(
      canBelongToParentZone({
        id: 'dock',
        type: 'DockingPoint',
        name: 'DockingPoint',
        customName: '',
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Normal',
      }),
      false,
    )
  })

  it('strips zone keys from non-matching component types', () => {
    const track = sanitizeZoneParameters({
      id: 'cross',
      type: 'Track',
      name: 'RailCross',
      customName: '',
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Idle',
      parameters: {
        parentZoneId: 'zone-1',
        zoneLocalField: { u: 0.5, v: 0.5 },
        zoneEntranceLinks: [],
        zonePartitionEntranceId: 'ent-1',
        zonePartitionLinkId: 'zl-1',
        railWidthM: 1.2,
      },
    })
    assert.equal(track.parameters?.parentZoneId, undefined)
    assert.equal(track.parameters?.zoneLocalField, undefined)
    assert.equal(track.parameters?.zoneEntranceLinks, undefined)
    assert.equal(track.parameters?.zonePartitionEntranceId, undefined)
    assert.equal(track.parameters?.zonePartitionLinkId, undefined)
    assert.equal(track.parameters?.railWidthM, 1.2)

    const area = sanitizeZoneParameters({
      id: 'a',
      type: 'Facility',
      name: 'FacilityArea',
      customName: '',
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        parentZoneId: 'zone-1',
        zoneEntranceLinks: [],
        zonePartitionEntranceId: 'ent-1',
      },
    })
    assert.equal(area.parameters?.parentZoneId, 'zone-1')
    assert.equal(area.parameters?.zoneEntranceLinks, undefined)
    assert.equal(area.parameters?.zonePartitionEntranceId, undefined)
  })
})

describe('zonePartition field mapping', () => {
  it('maps local 0–1 to absolute field and back', () => {
    const bounds = { xMinM: 100, xMaxM: 200, yMinM: 10, yMaxM: 50 }
    const abs = zoneLocalToAbsolute({ u: 0.25, v: 0.5 }, bounds)
    assert.equal(abs.xM, 125)
    assert.equal(abs.yM, 30)
    const local = absoluteToZoneLocal(abs.xM, abs.yM, bounds)
    assert.ok(Math.abs(local.u - 0.25) < 1e-9)
    assert.ok(Math.abs(local.v - 0.5) < 1e-9)
  })

  it('syncs partition bounds from entrance links', () => {
    const link = createZoneEntranceLink({
      id: 'zl-1',
      name: '倉庫',
      xMinM: 0,
      xMaxM: 40,
      yMinM: 0,
      yMaxM: 20,
      zoneFacilityId: 'zone-1',
    })
    const facilities: FacilityObject[] = [
      {
        id: 'ent-1',
        type: 'Facility',
        name: 'ZoneEntrance',
        customName: '',
        areaPosition: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: 'Normal',
        parameters: {},
      },
      {
        id: 'zone-1',
        type: 'Facility',
        name: 'ZonePartition',
        customName: '',
        areaPosition: { x: 10, y: 10 },
        position: { x: 10, y: 10 },
        rotation: 0,
        currentState: 'Normal',
        parameters: {},
      },
    ]
    const next = applyEntranceLinksToAreaFacilities(facilities, 'ent-1', [link])
    const zone = next.find((f) => f.id === 'zone-1')!
    assert.equal(zone.parameters?.refFieldXMinM, 0)
    assert.equal(zone.parameters?.refFieldXMaxM, 40)
    assert.equal(zone.parameters?.refFieldYMaxM, 20)
    assert.equal(zone.parameters?.zonePartitionEntranceId, 'ent-1')
    assert.equal(zone.customName, '倉庫')
  })

  it('updates child absolute field from canvas placement inside zone', () => {
    const area = {
      id: 'a1',
      name: 'A',
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      layout: { xPx: 0, yPx: 0, wPx: 1000, hPx: 1000 },
      facilities: [] as FacilityObject[],
    } as MapAreaObject

    const zone: FacilityObject = {
      id: 'zone-1',
      type: 'Facility',
      name: 'ZonePartition',
      customName: 'Z',
      areaPosition: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      areaSizePx: { w: 200, h: 100 },
      parameters: {
        refFieldXMinM: 100,
        refFieldXMaxM: 200,
        refFieldYMinM: 0,
        refFieldYMaxM: 50,
      },
    }
    const child: FacilityObject = {
      id: 'child-1',
      type: 'Facility',
      name: 'FacilityArea',
      customName: '',
      areaPosition: { x: 50, y: 25 },
      position: { x: 50, y: 25 },
      rotation: 0,
      currentState: 'Normal',
      areaSizePx: { w: 20, h: 20 },
      parameters: {
        [PARENT_ZONE_ID_KEY]: 'zone-1',
      },
    }
    area.facilities = [zone, child]
    const synced = syncZoneChildFieldFromPlacement(child, area)
    const local = synced.parameters?.[ZONE_LOCAL_FIELD_KEY] as {
      u: number
      v: number
    }
    // center at (60,35) in zone 200x100 → u=0.3 v=0.35 → field (130, 17.5)
    assert.ok(Math.abs(local.u - 0.3) < 1e-6)
    assert.ok(Math.abs(local.v - 0.35) < 1e-6)
    assert.equal(synced.parameters?.refFieldXMinM, 130)
    assert.equal(synced.parameters?.refFieldXMaxM, 130)
    assert.equal(synced.parameters?.refFieldYMinM, 17.5)
    assert.equal(synced.parameters?.refFieldYMaxM, 17.5)
  })

  it('hides already-linked partitions from available list', () => {
    const zoneA: FacilityObject = {
      id: 'zone-a',
      type: 'Facility',
      name: 'ZonePartition',
      customName: 'A',
      areaPosition: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {},
    }
    const zoneB: FacilityObject = {
      ...zoneA,
      id: 'zone-b',
      customName: 'B',
    }
    const entrance: FacilityObject = {
      id: 'ent-1',
      type: 'Facility',
      name: 'ZoneEntrance',
      customName: '',
      areaPosition: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        zoneEntranceLinks: [
          createZoneEntranceLink({
            id: 'zl-1',
            name: 'A',
            zoneFacilityId: 'zone-a',
          }),
        ],
      },
    }
    const available = availableZonePartitionsForEntrance([
      entrance,
      zoneA,
      zoneB,
    ])
    assert.deepEqual(
      available.map((z) => z.id),
      ['zone-b'],
    )
    const link = createZoneEntranceLinkFromPartition(zoneB)
    assert.equal(link.zoneFacilityId, 'zone-b')
    assert.equal(link.name, 'B')
  })

  it('clamps child facility inside parent zone bounds', () => {
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    area.layout = { ...area.layout, wPx: 400, hPx: 400 }
    area.domain = { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 }
    const zone: FacilityObject = {
      id: 'zone-1',
      type: 'Facility',
      name: 'ZonePartition',
      customName: 'Z',
      areaPosition: { x: 50, y: 50 },
      areaSizePx: { w: 100, h: 80 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        refFieldXMinM: 0,
        refFieldXMaxM: 40,
        refFieldYMinM: 0,
        refFieldYMaxM: 20,
      },
    }
    const child: FacilityObject = {
      id: 'fac-1',
      type: 'Facility',
      name: 'FacilityArea',
      customName: '',
      areaPosition: { x: 0, y: 0 },
      areaSizePx: { w: 40, h: 30 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        parentZoneId: 'zone-1',
      },
    }
    const withFacilities = {
      ...area,
      facilities: [zone, child],
    }
    const clamped = clampFacilityInsideParentZone(child, withFacilities)
    assert.ok(clamped.areaPosition)
    assert.ok(clamped.areaPosition!.x >= 50)
    assert.ok(clamped.areaPosition!.y >= 50)
    assert.ok(
      clamped.areaPosition!.x + (clamped.areaSizePx?.w ?? 0) <= 150 + 1e-6,
    )
    assert.ok(
      clamped.areaPosition!.y + (clamped.areaSizePx?.h ?? 0) <= 130 + 1e-6,
    )
  })

  it('creates FacilityArea inside zone with parent binding', () => {
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    area.layout = { ...area.layout, wPx: 400, hPx: 400 }
    const zone: FacilityObject = {
      id: 'zone-1',
      type: 'Facility',
      name: 'ZonePartition',
      customName: 'Z',
      areaPosition: { x: 40, y: 40 },
      areaSizePx: { w: 120, h: 100 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        refFieldXMinM: -900,
        refFieldXMaxM: -873,
        refFieldYMinM: -330,
        refFieldYMaxM: -262,
      },
    }
    const created = createFacilityAreaInsideZone(
      zone,
      { ...area, facilities: [zone] },
      '200',
    )
    assert.ok(created)
    assert.equal(created!.name, 'FacilityArea')
    assert.equal(created!.parameters?.parentZoneId, 'zone-1')
    assert.ok(created!.areaPosition)
    assert.ok(created!.areaPosition!.x >= 40)
    assert.ok(
      created!.areaPosition!.x + (created!.areaSizePx?.w ?? 0) <= 160 + 1e-6,
    )
  })

  it('rematerializes children onto moved/resized zone canvas', () => {
    const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)
    area.layout = { ...area.layout, wPx: 400, hPx: 400 }
    area.domain = { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 }
    const zone: FacilityObject = {
      id: 'zone-1',
      type: 'Facility',
      name: 'ZonePartition',
      customName: 'Z',
      areaPosition: { x: 0, y: 0 },
      areaSizePx: { w: 200, h: 100 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        refFieldXMinM: 0,
        refFieldXMaxM: 100,
        refFieldYMinM: 0,
        refFieldYMaxM: 50,
      },
    }
    const child: FacilityObject = {
      id: 'child-1',
      type: 'Facility',
      name: 'FacilityArea',
      customName: 'M1',
      areaPosition: { x: 90, y: 40 },
      areaSizePx: { w: 20, h: 20 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        [PARENT_ZONE_ID_KEY]: 'zone-1',
        [ZONE_LOCAL_FIELD_KEY]: { u: 0.5, v: 0.5 },
      },
    }
    const movedZone: FacilityObject = {
      ...zone,
      areaPosition: { x: 40, y: 20 },
      areaSizePx: { w: 100, h: 80 },
    }
    const next = rematerializeZoneChildrenOntoZoneCanvas(
      [movedZone, child],
      'zone-1',
      { ...area, facilities: [movedZone, child] },
    )
    const out = next.find((f) => f.id === 'child-1')!
    // center at zone mid: (40+50, 20+40) = (90, 60) → top-left (80, 50)
    assert.ok(Math.abs(out.areaPosition.x - 80) < 1e-6)
    assert.ok(Math.abs(out.areaPosition.y - 50) < 1e-6)
  })
})
