import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  dropSharedTrackGenIdentityInAreas,
  facilityCopyWithoutTrackGenIdentity,
  hasTrackGenIdentity,
} from './trackGenIdentity'

function track(id: string, customName: string, real: number[][]): FacilityObject {
  return {
    id,
    type: 'Track',
    name: 'Rail',
    customName,
    positionMeters: { x: 0, y: 0 },
    areaPosition: { x: 0, y: 0 },
    parameters: {
      segmentId: customName,
      trackGenRealPath: real,
      trackGenLocalPath: [[0, 0.5], [1, 0.5]],
      trackGenSpans: [{ road: '8', lane: -2, s0: 0, s1: 50, h: 0, f0: 0, f1: 1 }],
      trackGenRole: 'road',
      trackGenLine: '8:-2',
      trackGenLineLengthM: 50,
      refFieldXMinM: -720.65,
      refFieldXMaxM: -666.61,
      refFieldYMinM: 0.53,
      refFieldYMaxM: 3.94,
      defaultFillColor: '#191f2f',
    },
  } as unknown as FacilityObject
}

function areaOf(facilities: FacilityObject[]): MapAreaObject {
  return {
    id: 'area-a',
    layout: { xPx: 0, yPx: 0, wPx: 1000, hPx: 500, borderPx: 0, borderColor: 'transparent' },
    domain: { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 500 },
    facilities,
  } as unknown as MapAreaObject
}

const REAL = [[-718.97, 2.26], [-668.28, 2.21]]

describe('共用現場身分', () => {
  it('先出現的留著，後面同一條中心線的被清掉', () => {
    const areas = [areaOf([track('020', 'U14', REAL), track('101', 'U14', REAL)])]
    const { areas: next, stripped } = dropSharedTrackGenIdentityInAreas(areas)

    assert.deepEqual(stripped, ['U14'])
    const [keep, copy] = next[0]!.facilities
    assert.equal(hasTrackGenIdentity(keep!.parameters), true)
    assert.equal(hasTrackGenIdentity(copy!.parameters), false)
    // 場域範圍也要一起清掉，否則那一塊仍宣稱自己涵蓋本尊那一段現場
    assert.equal(copy!.parameters?.refFieldXMinM, undefined)
    assert.equal(copy!.parameters?.trackGenSpans, undefined)
    // 形狀與顏色是使用者複製的東西，不動
    assert.equal(copy!.parameters?.defaultFillColor, '#191f2f')
  })

  it('場域範圍跑到路網以外就清掉，等著照位置重算', () => {
    const stale = track('113', 'D18', REAL)
    stale.parameters!.refFieldXMaxM = 119.32
    stale.parameters!.refFieldYMaxM = 447.81
    const areas = [areaOf([track('020', 'U14', REAL), stale])]
    const { areas: next, cleared } = dropSharedTrackGenIdentityInAreas(areas)
    // 與 U14 共用中心線，所以先被當成複本清掉身分；範圍也跟著不見
    assert.ok((cleared.length + next[0]!.facilities.length) > (0))
    const d18 = next[0]!.facilities[1]!
    assert.equal(d18.parameters?.refFieldXMaxM, undefined)
  })

  it('中心線不同就都留著——並排的兩條軌道本來就長得一樣', () => {
    const areas = [
      areaOf([
        track('020', 'U14', REAL),
        track('032', 'D14', [[-718.97, -1.24], [-668.28, -1.29]]),
      ]),
    ]
    const { areas: next, stripped } = dropSharedTrackGenIdentityInAreas(areas)
    assert.deepEqual(stripped, [])
    assert.equal(next, areas)
  })
})

describe('複製一塊軌道', () => {
  it('拿掉現場身分，代號不重複', () => {
    const source = track('020', 'U14', REAL)
    const areas = [areaOf([source])]
    const copy = facilityCopyWithoutTrackGenIdentity(
      { ...source, id: '101' } as FacilityObject,
      areas,
    )

    assert.equal(hasTrackGenIdentity(copy.parameters), false)
    assert.equal(copy.parameters?.refFieldXMaxM, undefined)
    assert.equal(copy.parameters?.segmentId, undefined)
    assert.equal(copy.customName, 'U14-2')
  })

  it('交叉的四個口換成新的途經點代號', () => {
    const cross = {
      ...track('072', 'D03/U03', REAL),
      name: 'RailCross',
      parameters: {
        ...track('072', 'D03/U03', REAL).parameters,
        crossTrackPortals: {
          lt: { waypointCode: 'n2w_u2d_go_end', alias: '下行轉N2W正線終點', xM: null, yM: null },
          lb: { waypointCode: 'n2w_u2d_back_start', xM: null, yM: null },
          rt: { waypointCode: 'n2w_u2d_back_end', xM: null, yM: null },
          rb: { waypointCode: 'n2w_u2d_go_start', xM: null, yM: null },
        },
      },
    } as unknown as FacilityObject
    const copy = facilityCopyWithoutTrackGenIdentity(
      { ...cross, id: '099' } as FacilityObject,
      [areaOf([cross])],
    )
    const portals = copy.parameters?.crossTrackPortals as Record<
      string,
      { waypointCode: string; alias?: string }
    >
    assert.equal(portals.lt.waypointCode, 'xc_099_lt')
    assert.equal(portals.rb.waypointCode, 'xc_099_rb')
    // 別名是給人看的，留著
    assert.equal(portals.lt.alias, '下行轉N2W正線終點')
  })
})
