import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  applyAutoRefFieldPositionIfUnset,
  areaSupportsAutoFieldCoords,
  ensureAutoRefFieldPositionsInAreas,
  shouldAutoSeedRefFieldPoint,
  suggestRefFieldPositionFromPlacement,
  syncAutoRefFieldPositionFromPlacement,
} from './facilityRefFieldAuto'
import { hasValidRefFieldPosition } from './facilityRefFieldPosition'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'

function dockingAt(areaPos: { x: number; y: number }, size = { w: 20, h: 20 }): FacilityObject {
  return {
    id: 'd1',
    type: 'DockingPoint',
    name: 'DockingPoint',
    customName: 'N2W下行',
    areaPosition: areaPos,
    areaSizePx: size,
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      stationId: 'station_1',
      refFieldXM: null,
      refFieldYM: null,
    },
  }
}

function trackWithGenPaths(): FacilityObject {
  return {
    id: 't1',
    type: 'Track',
    name: 'Track',
    customName: 'gen',
    areaPosition: { x: 0, y: 0 },
    areaSizePx: { w: 1000, h: 100 },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      [TRACKGEN_REAL_PATH_KEY]: [
        [0, 50],
        [100, 50],
      ],
      [TRACKGEN_LOCAL_PATH_KEY]: [
        [0, 0.5],
        [1, 0.5],
      ],
    },
  }
}

function areaWithDomain(facilities: FacilityObject[] = []) {
  return {
    ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
    domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
    layout: {
      xPx: 0,
      yPx: 0,
      wPx: 1000,
      hPx: 1000,
      borderPx: 0,
    },
    facilities,
  }
}

describe('facilityRefFieldAuto', () => {
  it('auto-seeds all ref-field point facility types', () => {
    assert.equal(shouldAutoSeedRefFieldPoint('DockingPoint'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Waypoint'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Signal'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Pole'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('PSD'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Track'), false)
    assert.equal(shouldAutoSeedRefFieldPoint('Facility'), false)
  })

  it('plain Area does not support auto field coords', () => {
    const area = areaWithDomain()
    assert.equal(areaSupportsAutoFieldCoords(area), false)
  })

  it('Area with track-gen paths supports auto field coords', () => {
    const area = areaWithDomain([trackWithGenPaths()])
    assert.equal(areaSupportsAutoFieldCoords(area), true)
  })

  it('does not suggest field meters on plain Area', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 200 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 1000,
        hPx: 2000,
        borderPx: 0,
      },
    }
    const f = dockingAt({ x: 500, y: 1000 }, { w: 20, h: 20 })
    assert.equal(suggestRefFieldPositionFromPlacement(f, area), null)
    assert.equal(applyAutoRefFieldPositionIfUnset(f, area), f)
  })

  it('suggests field meters when Area has track-gen paths', () => {
    const area = areaWithDomain([trackWithGenPaths()])
    const f = dockingAt({ x: 500, y: 40 }, { w: 20, h: 20 })
    const suggested = suggestRefFieldPositionFromPlacement(f, area)
    assert.ok(suggested)
    assert.ok(Number.isFinite(suggested!.xM))
    assert.ok(Number.isFinite(suggested!.yM))
  })

  it('writes suggested position only when unset on HD Area', () => {
    const area = areaWithDomain([trackWithGenPaths()])
    const unset = dockingAt({ x: 100, y: 40 })
    const seeded = applyAutoRefFieldPositionIfUnset(unset, area)
    assert.ok(hasValidRefFieldPosition(seeded.parameters))

    const manual: FacilityObject = {
      ...unset,
      parameters: { ...unset.parameters, refFieldXM: 12.5, refFieldYM: 33 },
    }
    const kept = applyAutoRefFieldPositionIfUnset(manual, area)
    assert.equal(kept.parameters?.refFieldXM, 12.5)
    assert.equal(kept.parameters?.refFieldYM, 33)
  })

  it('ensureAutoRefFieldPositionsInAreas skips plain Areas', () => {
    const area = {
      ...areaWithDomain([dockingAt({ x: 50, y: 50 })]),
      facilities: [dockingAt({ x: 50, y: 50 })],
    }
    const areas = [area]
    const next = ensureAutoRefFieldPositionsInAreas(areas)
    assert.equal(next, areas)
    assert.equal(hasValidRefFieldPosition(next[0]!.facilities[0]!.parameters), false)
  })

  it('ensureAutoRefFieldPositionsInAreas seeds unset points on HD Area', () => {
    const area = areaWithDomain([
      trackWithGenPaths(),
      dockingAt({ x: 50, y: 40 }),
    ])
    const next = ensureAutoRefFieldPositionsInAreas([area])
    const docking = next[0]!.facilities.find((f) => f.type === 'DockingPoint')
    assert.ok(hasValidRefFieldPosition(docking?.parameters))
  })

  it('sync overwrites existing position when placement moves on HD Area', () => {
    const area = areaWithDomain([trackWithGenPaths()])
    const atStart: FacilityObject = {
      ...dockingAt({ x: 100, y: 40 }),
      parameters: {
        stationId: 'station_1',
        refFieldXM: 1,
        refFieldYM: 2,
      },
    }
    const moved = {
      ...atStart,
      areaPosition: { x: 400, y: 40 },
    }
    const synced = syncAutoRefFieldPositionFromPlacement(moved, area)
    assert.notEqual(synced.parameters?.refFieldXM, 1)
    assert.ok(hasValidRefFieldPosition(synced.parameters))
  })

  it('sync does not overwrite on plain Area', () => {
    const area = areaWithDomain()
    const atStart: FacilityObject = {
      ...dockingAt({ x: 100, y: 100 }),
      parameters: {
        stationId: 'station_1',
        refFieldXM: 1,
        refFieldYM: 2,
      },
    }
    const moved = {
      ...atStart,
      areaPosition: { x: 400, y: 400 },
    }
    const synced = syncAutoRefFieldPositionFromPlacement(moved, area)
    assert.equal(synced.parameters?.refFieldXM, 1)
    assert.equal(synced.parameters?.refFieldYM, 2)
  })

  it('suggests and syncs for Signal / Pole / PSD on HD Area', () => {
    const area = areaWithDomain([trackWithGenPaths()])
    const cases: Array<{ type: FacilityObject['type']; state: FacilityObject['currentState'] }> = [
      { type: 'Signal', state: 'Normal' },
      { type: 'Pole', state: 'Normal' },
      { type: 'PSD', state: 'Closed' },
    ]
    for (const { type, state } of cases) {
      const f: FacilityObject = {
        id: `${type}-1`,
        type,
        name: type,
        customName: '',
        areaPosition: { x: 200, y: 40 },
        areaSizePx: { w: 20, h: 20 },
        position: { x: 0, y: 0 },
        rotation: 0,
        currentState: state,
        parameters: { refFieldXM: null, refFieldYM: null },
      }
      const seeded = applyAutoRefFieldPositionIfUnset(f, area)
      assert.ok(hasValidRefFieldPosition(seeded.parameters), type)
      const moved = {
        ...seeded,
        areaPosition: { x: 500, y: 40 },
      }
      const synced = syncAutoRefFieldPositionFromPlacement(moved, area)
      assert.ok(hasValidRefFieldPosition(synced.parameters), type)
    }
  })
})
