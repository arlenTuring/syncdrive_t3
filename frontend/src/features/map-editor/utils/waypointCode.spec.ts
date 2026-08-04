import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  collectCrossoverPortalWaypointsFromAreas,
  generateNextCrossoverPortalCodes,
  isWaypointCodeTaken,
  patchCrossoverPortalWaypointCode,
} from './waypointCode'

function facility(
  partial: Partial<FacilityObject> & Pick<FacilityObject, 'id' | 'type'>,
): FacilityObject {
  return {
    name: partial.type,
    customName: partial.customName ?? partial.id,
    position: { x: 0, y: 0 },
    areaPosition: { x: 0, y: 0 },
    areaLayoutAnchor: { wPx: 100, hPx: 100 },
    rotation: 0,
    parameters: {},
    ...partial,
  } as FacilityObject
}

function areasWith(...facilities: FacilityObject[]): MapAreaObject[] {
  return [
    {
      id: '1',
      customName: 'A',
      layout: { xPx: 0, yPx: 0, wPx: 800, hPx: 600, borderPx: 1 },
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      view: { panXM: 0, panYM: 0, zoom: 1 },
      facilities,
    },
  ]
}

describe('waypointCode crossover portals', () => {
  it('generates unique xo_n_a / xo_n_b codes', () => {
    const areas = areasWith(
      facility({
        id: 'wp1',
        type: 'Waypoint',
        parameters: { waypointCode: 'xo_1_a' },
      }),
    )
    const pair = generateNextCrossoverPortalCodes(areas)
    assert.equal(pair.a, 'xo_2_a')
    assert.equal(pair.b, 'xo_2_b')
  })

  it('treats crossover portal codes as globally unique with waypoints', () => {
    const areas = areasWith(
      facility({
        id: 'xo1',
        type: 'TrackCrossover',
        parameters: {
          trackCrossoverPortals: {
            a: { xM: 0, yM: 0, attachedTrackId: null, waypointCode: 'xo_1_a' },
            b: { xM: 1, yM: 1, attachedTrackId: null, waypointCode: 'xo_1_b' },
          },
        },
      }),
      facility({
        id: 'wp1',
        type: 'Waypoint',
        parameters: { waypointCode: 'WP1' },
      }),
    )

    assert.equal(isWaypointCodeTaken(areas, 'xo_1_a'), true)
    assert.equal(isWaypointCodeTaken(areas, 'WP1'), true)
    assert.equal(
      isWaypointCodeTaken(areas, 'xo_1_a', {
        crossoverPortal: { facilityId: 'xo1', key: 'a' },
      }),
      false,
    )

    const conflict = patchCrossoverPortalWaypointCode(
      areas[0]!.facilities[0]!,
      areas,
      'b',
      'WP1',
    )
    assert.equal(conflict.error, '此代號已被其他途經點使用')

    const collected = collectCrossoverPortalWaypointsFromAreas(areas)
    assert.equal(collected.length, 2)
    assert.deepEqual(
      collected.map((c) => c.stationId).sort(),
      ['xo_1_a', 'xo_1_b'],
    )
  })
})
