import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  applyAutoRefFieldBoundsIfUnset,
  shouldAutoSeedRefFieldBounds,
  suggestRefFieldCornersFromPlacement,
  trackFootprintCornersAreaLocal,
} from './facilityRefFieldBoundsAuto'
import { hasValidRefFieldBounds } from './facilityRefFieldBounds'
import { hasValidRefFieldCorners } from './facilityRefFieldCorners'
import {
  DEFAULT_TAPER_TRACK,
  normalizeTaperTrackGeometry,
  TAPER_TRACK_KEY,
} from './trackShapes'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'

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

function taperFacility(overrides?: Partial<FacilityObject>): FacilityObject {
  return {
    id: 'taper1',
    type: 'Track',
    name: 'RailTaper',
    customName: '',
    areaPosition: { x: 200, y: 40 },
    areaSizePx: { w: 120, h: 80 },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      refFieldXMinM: null,
      refFieldXMaxM: null,
      refFieldYMinM: null,
      refFieldYMaxM: null,
      [TAPER_TRACK_KEY]: { ...DEFAULT_TAPER_TRACK },
    },
    ...overrides,
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

describe('facilityRefFieldBoundsAuto', () => {
  it('auto-seeds Track bounds only', () => {
    assert.equal(shouldAutoSeedRefFieldBounds('Track'), true)
    assert.equal(shouldAutoSeedRefFieldBounds('Facility'), false)
    assert.equal(shouldAutoSeedRefFieldBounds('DockingPoint'), false)
  })

  it('does not suggest corners on plain Area', () => {
    const area = areaWithDomain([taperFacility()])
    assert.equal(suggestRefFieldCornersFromPlacement(taperFacility(), area), null)
  })

  it('RailTaper footprint has four trapezoid corners', () => {
    const f = taperFacility()
    const area = areaWithDomain([trackWithGenPaths(), f])
    const corners = trackFootprintCornersAreaLocal(f, area)
    assert.equal(corners.length, 4)
  })

  it('suggests four field corner points for RailTaper on HD Area', () => {
    const f = taperFacility()
    const area = areaWithDomain([trackWithGenPaths(), f])
    const corners = suggestRefFieldCornersFromPlacement(f, area)
    assert.ok(corners)
    assert.equal(corners!.length, 4)
    for (const c of corners!) {
      assert.ok(c.xM !== null && Number.isFinite(c.xM))
      assert.ok(c.yM !== null && Number.isFinite(c.yM))
    }
  })

  it('writes four corners (and derived bounds) only when corners unset', () => {
    const f = taperFacility()
    const area = areaWithDomain([trackWithGenPaths(), f])
    const seeded = applyAutoRefFieldBoundsIfUnset(f, area)
    assert.ok(hasValidRefFieldCorners(seeded.parameters))
    assert.ok(hasValidRefFieldBounds(seeded.parameters))

    const kept = applyAutoRefFieldBoundsIfUnset(seeded, area)
    assert.equal(kept, seeded)
  })
})

describe('normalizeTaperTrackGeometry', () => {
  it('swaps b ends when from/to directions disagree', () => {
    const knotted = normalizeTaperTrackGeometry({
      aFrom: 0.2,
      aTo: 0.8,
      bFrom: 0.9,
      bTo: 0.3,
      entryDeg: 0,
    })
    assert.equal(knotted.bFrom, 0.3)
    assert.equal(knotted.bTo, 0.9)
    assert.ok((knotted.aFrom - knotted.aTo) * (knotted.bFrom - knotted.bTo) >= 0)
  })
})
