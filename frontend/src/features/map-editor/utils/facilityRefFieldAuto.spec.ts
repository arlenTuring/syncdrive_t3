import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  applyAutoRefFieldPositionIfUnset,
  ensureAutoRefFieldPositionsInAreas,
  shouldAutoSeedRefFieldPoint,
  suggestRefFieldPositionFromPlacement,
  syncAutoRefFieldPositionFromPlacement,
} from './facilityRefFieldAuto'
import { hasValidRefFieldPosition } from './facilityRefFieldPosition'

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

describe('facilityRefFieldAuto', () => {
  it('only auto-seeds DockingPoint and Waypoint', () => {
    assert.equal(shouldAutoSeedRefFieldPoint('DockingPoint'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Waypoint'), true)
    assert.equal(shouldAutoSeedRefFieldPoint('Signal'), false)
    assert.equal(shouldAutoSeedRefFieldPoint('Pole'), false)
  })

  it('suggests field meters from area domain when no track gen', () => {
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
    // 中心在 (510, 1010) area-local → domain 比例約 (51, 101)
    const f = dockingAt({ x: 500, y: 1000 }, { w: 20, h: 20 })
    const suggested = suggestRefFieldPositionFromPlacement(f, area)
    assert.ok(suggested)
    assert.ok(Math.abs(suggested!.xM - 51) < 0.05)
    assert.ok(Math.abs(suggested!.yM - 101) < 0.05)
  })

  it('writes suggested position only when unset', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 1000,
        hPx: 1000,
        borderPx: 0,
      },
    }
    const unset = dockingAt({ x: 100, y: 100 })
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

  it('ensureAutoRefFieldPositionsInAreas seeds all unset docking points', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 50, yMinM: 0, yMaxM: 50 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 500,
        hPx: 500,
        borderPx: 0,
      },
      facilities: [dockingAt({ x: 50, y: 50 })],
    }
    const next = ensureAutoRefFieldPositionsInAreas([area])
    assert.ok(hasValidRefFieldPosition(next[0]!.facilities[0]!.parameters))
  })

  it('sync overwrites existing position when placement moves', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 1000,
        hPx: 1000,
        borderPx: 0,
      },
    }
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
    assert.notEqual(synced.parameters?.refFieldXM, 1)
    assert.notEqual(synced.parameters?.refFieldYM, 2)
    assert.ok(hasValidRefFieldPosition(synced.parameters))
  })
})
