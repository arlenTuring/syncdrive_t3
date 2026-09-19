import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  collectWaypointCodes,
  isWaypointCodeTaken,
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

describe('waypointCode cross portals', () => {
  const rail = () =>
    facility({
      id: 'cross1',
      type: 'Track',
      name: 'RailCross',
      parameters: {
        crossTrackPortals: {
          lt: { waypointCode: 'n2w_go_end' },
          lb: { waypointCode: 'n2w_back_start' },
          rt: { waypointCode: 'n2w_back_end' },
          rb: { waypointCode: 'n2w_go_start' },
        },
      },
    })

  it('交叉軌道四個口的代號跟一般途經點共用同一組，不能重複', () => {
    const areas = areasWith(
      rail(),
      facility({
        id: 'wp1',
        type: 'Waypoint',
        parameters: { waypointCode: 'WP1' },
      }),
    )
    assert.equal(isWaypointCodeTaken(areas, 'n2w_go_end'), true)
    assert.equal(isWaypointCodeTaken(areas, 'WP1'), true)
    assert.equal(isWaypointCodeTaken(areas, 'unused_code'), false)
  })

  it('編輯某一個口自己的代號時，不算撞自己', () => {
    const areas = areasWith(rail())
    assert.equal(
      isWaypointCodeTaken(areas, 'n2w_go_end', {
        crossPortal: { facilityId: 'cross1', key: 'lt' },
      }),
      false,
    )
    assert.equal(
      isWaypointCodeTaken(areas, 'n2w_back_start', {
        crossPortal: { facilityId: 'cross1', key: 'lt' },
      }),
      true,
    )
  })

  it('collectWaypointCodes 收得到四個口', () => {
    const codes = collectWaypointCodes(areasWith(rail()))
    assert.deepEqual([...codes].sort(), [
      'n2w_back_end',
      'n2w_back_start',
      'n2w_go_end',
      'n2w_go_start',
    ])
  })
})
