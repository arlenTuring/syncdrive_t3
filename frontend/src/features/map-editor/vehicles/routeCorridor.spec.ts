import { describe, expect, it } from 'vitest'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { buildTrackGenIndex, locateByField, OFF_ROUTE_PENALTY_M, type LocateFacility } from '../utils/trackGenLocate'
import {
  advanceRouteIndex,
  buildRoutePath,
  buildRouteCorridors,
  readTargetStationId,
  routeWindow,
  shortestCorridor,
  shortestPiecePath,
} from './routeCorridor'

/**
 * 訂單路線 → 走廊。用手算得出答案的小路網驗：
 *
 *   下行 D（往東，y=0）：d1 → d2 → d3，各 50 公尺
 *   上行 U（往西，y=3.5）：u3 → u2 → u1
 *   D 與 U 只在最兩端各有一塊接起來的短連接（c_e、c_w）——沒有任何地方可以直接從 D 跳到 U。
 */

type Pt = [number, number]
const EAST = 0
const WEST = Math.PI

function piece(id: string, real: Pt[], h: number): LocateFacility {
  return {
    id,
    parameters: {
      trackGenRealPath: real,
      trackGenLocalPath: real.map(([x, y]) => [x / 1000, y / 1000]),
      trackGenSpans: [{ road: id, lane: h === EAST ? -1 : 1, s0: 0, s1: 50, h, f0: 0, f1: 1 }],
    },
  }
}

const facilities: LocateFacility[] = [
  piece('d1', [[0, 0], [50, 0]], EAST),
  piece('d2', [[50, 0], [100, 0]], EAST),
  piece('d3', [[100, 0], [150, 0]], EAST),
  piece('u3', [[150, 3.5], [100, 3.5]], WEST),
  piece('u2', [[100, 3.5], [50, 3.5]], WEST),
  piece('u1', [[50, 3.5], [0, 3.5]], WEST),
]

const index = buildTrackGenIndex(facilities)
const at = (id: string) => index.pieces.findIndex((p) => p.facilityId === id)

describe('最短路：走廊就是沿路網走得到的那幾塊', () => {
  it('同一條車道上前後相連：走過的每一塊都在', () => {
    expect([...shortestCorridor(index, at('d1'), at('d3'))!].sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('起點就是終點：只有這一塊', () => {
    expect([...shortestCorridor(index, at('d2'), at('d2'))!]).toEqual(['d2'])
  })

  it('上下行之間沒有接點：走不到對向車道', () => {
    // d3 的東端 (150,0) 與 u3 的起點 (150,3.5) 差 3.5 公尺、方向相反——是掉頭，不是相連
    expect(shortestCorridor(index, at('d1'), at('u1'))).toBeNull()
  })

  it('中間空了一小段：不憑距離猜，沒接上就沒有走廊（相接由接點保證）', () => {
    const gapped = buildTrackGenIndex([
      piece('a', [[0, 0], [50, 0]], EAST),
      // 空 15 公尺
      piece('b', [[65, 0], [115, 0]], EAST),
    ])
    expect(shortestCorridor(gapped, 0, 1)).toBeNull()
  })

  it('橫向差一條車道寬（3.4 公尺）：不算相連，不能從一條車道跳到隔壁', () => {
    const shifted = buildTrackGenIndex([
      piece('a', [[0, 0], [50, 0]], EAST),
      piece('b', [[50, 3.4], [100, 3.4]], EAST),
    ])
    expect(shortestCorridor(shifted, 0, 1)).toBeNull()
  })

  it('沒有方向：記錄順序與前進方向相反的軌道照樣連得起來', () => {
    const mixed = buildTrackGenIndex([
      piece('a', [[0, 0], [50, 0]], EAST),
      // 中心線記成由東往西，端點一樣相接
      piece('b', [[100, 0], [50, 0]], WEST),
      piece('c', [[100, 0], [150, 0]], EAST),
    ])
    expect([...shortestCorridor(mixed, 0, 2)!].sort()).toEqual(['a', 'b', 'c'])
  })

  it('兩條路都接得起來：走比較短的，與記錄的行車方向無關', () => {
    const two = buildTrackGenIndex([
      piece('s', [[0, 0], [10, 0]], EAST),
      piece('long', [[10, 0], [70, 0]], EAST),
      piece('short', [[10, 10], [30, 10]], WEST),
      piece('t', [[70, 0], [80, 0]], EAST),
      piece('s2short', [[10, 0], [10, 10]], EAST),
      piece('short2t', [[30, 10], [70, 0]], EAST),
    ])
    const at2 = (id: string) => two.pieces.findIndex((p) => p.facilityId === id)
    const path = shortestCorridor(two, at2('s'), at2('t'))!
    // 60 公尺的直路 vs 10 + 20 + 約 41 公尺的繞路
    expect(path.has('long')).toBe(true)
    expect(path.has('short')).toBe(false)
  })
})

describe('站與路線', () => {
  const dock = (id: string, stationId: string, x: number, y: number): FacilityObject =>
    ({
      id,
      type: 'DockingPoint',
      name: id,
      parameters: { stationId, refFieldXM: x, refFieldYM: y },
    }) as unknown as FacilityObject

  const track = (f: LocateFacility): FacilityObject =>
    ({ id: f.id, type: 'Track', name: f.id, customName: f.id, parameters: f.parameters }) as unknown as FacilityObject

  const areas = [
    {
      id: 'a',
      name: 'a',
      domain: { xMinM: 0, xMaxM: 200, yMinM: -10, yMaxM: 10 },
      layout: { xPx: 0, yPx: 0, wPx: 200, hPx: 20 },
      facilities: [
        ...facilities.map(track),
        dock('sd1', 'S1', 10, 0),
        dock('sd3', 'S3', 140, 0),
        dock('su1', 'SU', 10, 3.5),
      ],
    } as unknown as MapAreaObject,
  ]

  it('走廊記在終點站下面', () => {
    const c = buildRouteCorridors(areas, [{ stationIds: ['S1', 'S3'] }], index)
    expect([...c.byTargetStation.get('S3')!].sort()).toEqual(['d1', 'd2', 'd3'])
    expect(c.byTargetStation.has('S1')).toBe(false)
  })

  it('站序裡查不到軌道的（途經點）跳過，前後兩站照樣連得起來', () => {
    const c = buildRouteCorridors(areas, [{ stationIds: ['S1', 'not-a-station', 'S3'] }], index)
    expect(c.byTargetStation.get('S3')!.has('d2')).toBe(true)
  })

  it('接不起來（D 到 U）就沒有走廊，不憑空編一條', () => {
    const c = buildRouteCorridors(areas, [{ stationIds: ['S1', 'SU'] }], index)
    expect(c.byTargetStation.has('SU')).toBe(false)
  })

  it('沒有路網就沒有走廊', () => {
    expect(buildRouteCorridors(areas, [{ stationIds: ['S1', 'S3'] }], null).byTargetStation.size).toBe(0)
  })

  it('目標站取自 current_leg', () => {
    expect(readTargetStationId({ current_leg: { target_station_id: ' t3_u ' } })).toBe('t3_u')
    expect(readTargetStationId({ current_leg: {} })).toBeNull()
    expect(readTargetStationId(undefined)).toBeNull()
  })
})

describe('走廊在挑塊時只是加減分', () => {
  const corridor = new Set(['d1', 'd2', 'd3'])

  it('位置分不出來（兩條一樣近）：走廊內的贏', () => {
    // y=1.75 離 D、U 各 1.75
    expect(locateByField(index, 25, 1.75, { corridorFacilityIds: corridor })?.facilityId).toBe('d1')
    const upCorridor = new Set(['u1', 'u2', 'u3'])
    expect(locateByField(index, 25, 1.75, { corridorFacilityIds: upCorridor })?.facilityId).toBe('u1')
  })

  it('位置說得很清楚：走廊擋不住', () => {
    // 壓在 U 的中心線上，但走廊只有 D
    const hit = locateByField(index, 25, 3.5, { corridorFacilityIds: corridor })
    expect(hit?.facilityId).toBe('u1')
  })

  it('沒有走廊時行為不變', () => {
    expect(locateByField(index, 25, 0.4)?.facilityId).toBe('d1')
    expect(OFF_ROUTE_PENALTY_M).toBeGreaterThan(0)
  })

  it('位置只差一點點（D 1.9、U 1.6）：分不出來，走廊比「上一筆在 U」重要', () => {
    // 座標說不清楚時，訂單大致會經過哪些軌道是最可靠的旁證
    const hit = locateByField(index, 25, 1.9, { previousFacilityId: 'u1', corridorFacilityIds: corridor })
    expect(hit?.facilityId).toBe('d1')
  })

  it('位置差得多（D 2.9、U 0.6）：走廊與上一筆都翻不了，貼著哪條就是哪條', () => {
    const hit = locateByField(index, 25, 2.9, { previousFacilityId: 'd1', corridorFacilityIds: corridor })
    expect(hit?.facilityId).toBe('u1')
  })

  it('有走廊時車頭朝向只是最後的旁證：朝向與走廊打架，聽走廊的', () => {
    // 中間位置（各 1.75），走廊在 D、車頭卻朝著 U 車道的行進方向
    const uHeading = index.pieces.find((p) => p.facilityId === 'u1')!.travelRad
    expect(
      locateByField(index, 25, 1.75, { corridorFacilityIds: corridor, headingRad: uHeading, speedMps: 5 })?.facilityId,
    ).toBe('d1')
  })
})

describe('任務的有序路徑', () => {
  const stationPieces = new Map([
    ['A', at('d1')],
    ['B', at('d3')],
  ])

  it('最短路照行車順序排', () => {
    expect(shortestPiecePath(index, at('d1'), at('d3'))!.map((i) => index.pieces[i]!.facilityId)).toEqual([
      'd1',
      'd2',
      'd3',
    ])
  })

  it('站序逐段接起來，得到有順序的分支清單', () => {
    const path = buildRoutePath(index, stationPieces, ['A', 'B'], 'order-1')!
    expect(path.branchIds).toEqual(['d1', 'd2', 'd3'])
    expect(path.key).toBe('order-1')
  })

  it('站序裡查不到軌道的站列為未解析，前後查得到的照樣接', () => {
    const path = buildRoutePath(index, stationPieces, ['A', 'X', 'B'], 'k')!
    expect(path.branchIds).toEqual(['d1', 'd2', 'd3'])
    expect(path.unresolvedStations).toEqual(['X'])
  })

  it('合法後續：目前這一條加往前幾條；位置未知時整條路徑', () => {
    const path = buildRoutePath(index, stationPieces, ['A', 'B'], 'k')!
    expect([...routeWindow(path, 1, 1)]).toEqual(['d2', 'd3'])
    expect([...routeWindow(path, null)].sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('路徑進度只往前走；不在窗口內的分支不改進度', () => {
    const path = buildRoutePath(index, stationPieces, ['A', 'B'], 'k')!
    expect(advanceRouteIndex(path, null, 'd2')).toBe(1)
    expect(advanceRouteIndex(path, 1, 'd3')).toBe(2)
    expect(advanceRouteIndex(path, 2, 'd1')).toBe(2)
    expect(advanceRouteIndex(path, 1, 'u2')).toBe(1)
  })
})
