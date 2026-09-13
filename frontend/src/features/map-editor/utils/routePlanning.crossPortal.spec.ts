import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { CROSS_PORTALS_KEY } from './crossTrackPortals'
import { CROSS_TRACK_KEY, DEFAULT_CROSS_TRACK } from './trackShapes'
import { resolveCrossPortalRouteStopMapPx } from './routePlanning'

function areaWith(facility: FacilityObject): MapAreaObject[] {
  return [
    {
      id: '1',
      customName: '高精地圖 軌道',
      layout: { xPx: 0, yPx: 0, wPx: 400, hPx: 400 },
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 100 },
      facilities: [facility],
    } as MapAreaObject,
  ]
}

describe('resolveCrossPortalRouteStopMapPx', () => {
  it('places map stop on cross handle geometry, not field→domain', () => {
    /**
     * 手動場域設成 domain 外的負座標（模擬高精地圖場域）。
     * 若用 meterToAreaLocalPx(field, domain) 會畫到框外左下；
     * 正確作法是跟圖上綠點一樣，落在交叉軌道外框附近。
     */
    const cross: FacilityObject = {
      id: 'xc1',
      type: 'Track',
      name: 'RailCross',
      customName: 'U36',
      areaPosition: { x: 200, y: 200 },
      areaSizePx: { w: 80, h: 80 },
      position: { x: 50, y: 50 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        [CROSS_TRACK_KEY]: structuredClone(DEFAULT_CROSS_TRACK),
        [CROSS_PORTALS_KEY]: {
          lt: { waypointCode: 's2w_d2u_back_end', alias: '右上口', xM: -135.15, yM: -331.35 },
          lb: { waypointCode: 's2w_d2u_back_start', alias: '左下口', xM: -180.97, yM: -333.99 },
          rt: { waypointCode: 'xc_rt', xM: null, yM: null },
          rb: { waypointCode: 'xc_rb', xM: null, yM: null },
        },
      },
    }

    const areas = areaWith(cross)
    const start = resolveCrossPortalRouteStopMapPx(areas, 's2w_d2u_back_start')
    const end = resolveCrossPortalRouteStopMapPx(areas, 's2w_d2u_back_end')
    assert.ok(start)
    assert.ok(end)
    // 應落在交叉外框附近（areaPosition 200±80），絕不是 domain 外推的負座標
    assert.ok(start!.x > 150 && start!.x < 320, `start.x=${start!.x}`)
    assert.ok(start!.y > 80 && start!.y < 280, `start.y=${start!.y}`)
    assert.ok(end!.x > 150 && end!.x < 320, `end.x=${end!.x}`)
    assert.ok(end!.y > 80 && end!.y < 280, `end.y=${end!.y}`)
    // 場域座標仍回傳屬性面板那組數字
    assert.equal(start!.xM, -180.97)
    assert.equal(start!.yM, -333.99)
  })
})
