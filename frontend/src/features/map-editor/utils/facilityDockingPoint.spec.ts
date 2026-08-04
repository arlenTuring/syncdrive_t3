import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FacilityObject } from '../types/facility'
import {
  alongToFacilityDockingPoint,
  clampPointToRefFieldBounds,
  defaultFacilityDockingPoint,
  facilityDockingPointToAlong,
  getFacilityDockingPoint,
  parseFacilityDockingPoint,
  patchFacilityDockingPoint,
  resolveFacilityDockingPointListTitle,
  resolveFacilityDockingPointTopologyLabel,
} from './facilityDockingPoint'

const bounds = { xMinM: 100, xMaxM: 200, yMinM: 50, yMaxM: 150 }

function facility(params: Record<string, unknown>): FacilityObject {
  return {
    id: 'fac-1',
    type: 'Facility',
    name: 'FacilityArea',
    customName: '充電格 A',
    areaPosition: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      refFieldXMinM: 100,
      refFieldXMaxM: 200,
      refFieldYMinM: 50,
      refFieldYMaxM: 150,
      ...params,
    },
  }
}

describe('facilityDockingPoint', () => {
  it('parses and clamps to ref bounds', () => {
    assert.deepEqual(parseFacilityDockingPoint({ facilityDockingPoint: { xM: 150, yM: 100 } }), {
      xM: 150,
      yM: 100,
    })
    assert.deepEqual(
      clampPointToRefFieldBounds({ xM: 50, yM: 200 }, bounds),
      { xM: 100, yM: 150 },
    )
  })

  it('getFacilityDockingPoint clamps stored point', () => {
    const f = facility({ facilityDockingPoint: { xM: 999, yM: -10 } })
    assert.deepEqual(getFacilityDockingPoint(f), { xM: 200, yM: 50 })
  })

  it('default is left third, vertically centered', () => {
    const point = defaultFacilityDockingPoint(bounds)
    assert.ok(Math.abs(point.xM - (100 + 100 / 3)) < 1e-9)
    assert.equal(point.yM, 100)
  })

  it('along ↔ meters round-trip', () => {
    const point = alongToFacilityDockingPoint(0.25, 0.75, bounds)
    assert.equal(point.xM, 125)
    assert.equal(point.yM, 125)
    const along = facilityDockingPointToAlong(point, bounds)
    assert.ok(Math.abs(along.alongX - 0.25) < 1e-9)
    assert.ok(Math.abs(along.alongY - 0.75) < 1e-9)
  })

  it('patch clears and sets', () => {
    const cleared = patchFacilityDockingPoint(
      { purpose: '充電', facilityDockingPoint: { xM: 1, yM: 2 } },
      null,
    )
    assert.equal(cleared.facilityDockingPoint, undefined)
    assert.equal(cleared.purpose, '充電')
    const set = patchFacilityDockingPoint({}, { xM: 110, yM: 60 })
    assert.deepEqual(set.facilityDockingPoint, { xM: 110, yM: 60 })
  })

  it('list title / topology use default「設施名＋停靠點」or custom alias', () => {
    const f = facility({})
    f.customName = 'P1'
    assert.equal(resolveFacilityDockingPointListTitle(f), 'P1停靠點')
    assert.equal(resolveFacilityDockingPointTopologyLabel(f), 'P1停靠點')

    const withAlias = facility({
      facilityDockingPoint: { xM: 150, yM: 100, alias: '北側充電口' },
    })
    withAlias.customName = 'P1'
    assert.equal(resolveFacilityDockingPointListTitle(withAlias), '北側充電口')
    assert.equal(resolveFacilityDockingPointTopologyLabel(withAlias), '北側充電口')
  })

  it('patch preserves alias when set', () => {
    const set = patchFacilityDockingPoint({}, { xM: 110, yM: 60, alias: '別名A' })
    assert.deepEqual(set.facilityDockingPoint, { xM: 110, yM: 60, alias: '別名A' })
  })
})
