import { describe, expect, it } from 'vitest'
import { TRACK_CROSSOVER_PORTALS_KEY } from '../utils/trackCrossoverFacility'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveVehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'

/**
 * 轉線途中的場域點同時落在上下行軌道帶與橫渡線上。
 * 圖台必須畫在渡線上，不能吸到平行軌道中心線——否則視覺上就是「飄過去」。
 */

const DOMAIN = { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 500 }
const LAYOUT = { xPx: 0, yPx: 0, wPx: 1000, hPx: 500 }

function horizontalTrack(
  id: string,
  yMinM: number,
  yMaxM: number,
  yPx: number,
): FacilityObject {
  return {
    id,
    type: 'Track',
    name: id,
    customName: id,
    position: { x: 0, y: yPx },
    size: { w: 1000, h: 8 },
    areaPosition: { x: 0, y: yPx },
    areaSizePx: { w: 1000, h: 8 },
    parameters: {
      refFieldXMinM: 600,
      refFieldXMaxM: 800,
      refFieldYMinM: yMinM,
      refFieldYMaxM: yMaxM,
    },
  } as unknown as FacilityObject
}

function crossoverFacility(): FacilityObject {
  return {
    id: 'xo-1',
    type: 'TrackCrossover',
    name: '渡線',
    parameters: {
      [TRACK_CROSSOVER_PORTALS_KEY]: {
        a: {
          xM: 650,
          yM: 200,
          refFieldXM: 650,
          refFieldYM: 101.5,
          attachedTrackId: 'D',
          waypointCode: 'xo_a',
        },
        b: {
          xM: 750,
          yM: 220,
          refFieldXM: 750,
          refFieldYM: 105,
          attachedTrackId: 'U',
          waypointCode: 'xo_b',
        },
      },
    },
  } as unknown as FacilityObject
}

function areas(): MapAreaObject[] {
  return [
    {
      id: 'area-1',
      name: 'test',
      domain: DOMAIN,
      layout: LAYOUT,
      facilities: [
        horizontalTrack('D', 100, 103.5, 300),
        horizontalTrack('U', 103.5, 107, 280),
        crossoverFacility(),
      ],
    } as unknown as MapAreaObject,
  ]
}

describe('車輛圖台定位：橫渡線優先於軌道帶', () => {
  it('轉線中點畫在渡線上，不吸到上下行中心線', () => {
    // 現場中點：同時落在 U 帶（y≈105）與橫渡線上
    const xM = 700
    const yM = 103.25
    const placement = resolveVehiclePlacementAcrossAreas(areas(), xM, yM)
    expect(placement).not.toBeNull()
    expect(placement!.placement.trackId).toBe('xo-1')

    // 渡線中點的圖面 domain ≈ (700, 210) → area local（左下原點、y 向上）
    expect(placement!.placement.areaLocalX).toBeCloseTo(700, 0)
    expect(placement!.placement.areaLocalY).toBeCloseTo(210, 0)
  })

  it('離渡線遠的點仍吸到軌道中心線', () => {
    // 距橫渡線約 2.25 m（超過緊貼門檻 2 m），應判給下行軌道
    const placement = resolveVehiclePlacementAcrossAreas(areas(), 700, 101)
    expect(placement).not.toBeNull()
    expect(placement!.placement.trackId).toBe('D')
  })
})
