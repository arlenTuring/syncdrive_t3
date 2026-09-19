import { describe, expect, it } from 'vitest'
import { TRACK_CROSSOVER_PORTALS_KEY } from '../utils/trackCrossoverFacility'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { previousTrackIdOf, resolveVehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'

/**
 * 橫渡線只有在車<strong>真的在轉線</strong>時才畫在渡線上。
 *
 * 原本離渡線 2 公尺內一律判渡線——車沿正線開過渡線旁邊，離自己的中心線 0 公尺，也被
 * 拉到渡線上，畫面上突然側向飄過去再飄回來。這裡的軌道是生成的（有中心線可比）。
 */

const DOMAIN = { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 500 }
const LAYOUT = { xPx: 0, yPx: 0, wPx: 1000, hPx: 500 }

/** 一條生成的橫向軌道：中心線 y = yc，往東（h=0）或往西（h=π） */
function lane(id: string, yc: number, yPx: number, west: boolean): FacilityObject {
  const real = west ? [[800, yc], [600, yc]] : [[600, yc], [800, yc]]
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
      refFieldYMinM: yc - 1.675,
      refFieldYMaxM: yc + 1.675,
      trackGenRealPath: real,
      trackGenLocalPath: west ? [[1, 0.5], [0, 0.5]] : [[0, 0.5], [1, 0.5]],
      trackGenSpans: [
        { road: id, lane: west ? 1 : -1, s0: 0, s1: 200, h: west ? Math.PI : 0, f0: 0, f1: 1 },
      ],
    },
  } as unknown as FacilityObject
}

function crossover(
  a: { x: number; y: number },
  b: { x: number; y: number },
): FacilityObject {
  return {
    id: 'xo-1',
    type: 'TrackCrossover',
    name: '渡線',
    parameters: {
      [TRACK_CROSSOVER_PORTALS_KEY]: {
        a: { xM: a.x, yM: a.y * 2, refFieldXM: a.x, refFieldYM: a.y, attachedTrackId: 'D', waypointCode: 'xo_a' },
        b: { xM: b.x, yM: b.y * 2, refFieldXM: b.x, refFieldYM: b.y, attachedTrackId: 'U', waypointCode: 'xo_b' },
      },
    },
  } as unknown as FacilityObject
}

function areasWith(xo: FacilityObject): MapAreaObject[] {
  return [
    {
      id: 'area-1',
      name: 'test',
      domain: DOMAIN,
      layout: LAYOUT,
      // D：y=101.75 往東；U：y=105.25 往西，相距 3.5 公尺
      facilities: [lane('D', 101.75, 300, false), lane('U', 105.25, 280, true), xo],
    } as unknown as MapAreaObject,
  ]
}

const SHALLOW = () => crossover({ x: 650, y: 101.75 }, { x: 750, y: 105.25 })
const STEEP = () => crossover({ x: 700, y: 100 }, { x: 704, y: 107 })

describe('渡線：要真的在轉線才判渡線', () => {
  it('沿正線開過渡線旁邊：離自己的中心線 0 公尺，留在軌道上', () => {
    // (700, 101.75) 在 D 的中心線上；淺角渡線在 x=700 處 y≈103.5，離它約 1.7 公尺（在 2 公尺門檻內）
    const p = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 101.75, undefined, {
      headingRad: 0,
      speedMps: 8,
    })
    expect(p?.placement.trackId).toBe('D')
  })

  it('確認舊規則在這個點會判成渡線（離渡線在 2 公尺內）', () => {
    // 沒給朝向、也沒有中心線距離可比的舊路徑：離渡線 2 公尺內就是渡線。這裡驗的是
    // 「這個點確實落在 2 公尺門檻內」，所以上面那條測試才有意義
    const d = Math.abs(101.75 - (101.75 + ((700 - 650) / 100) * 3.5)) * Math.cos(Math.atan2(3.5, 100))
    expect(d).toBeLessThan(2)
  })

  it('夾在兩條中心線中間、貼著渡線：判渡線', () => {
    // 渡線中點 (700, 103.5)：離 D、U 中心線各 1.75，離渡線 0
    const p = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 103.5, undefined, {
      headingRad: 0.05,
      speedMps: 8,
    })
    expect(p?.placement.trackId).toBe('xo-1')
  })

  it('上一筆已經在渡線上：只要還在容許範圍內就留著', () => {
    // (700, 102.0)：離 D 中心線 0.25、離渡線約 1.5——沒有上一筆時判給軌道
    const without = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 102.0, undefined, {
      headingRad: 0.05,
      speedMps: 8,
    })
    expect(without?.placement.trackId).toBe('D')
    const stay = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 102.0, undefined, {
      headingRad: 0.05,
      speedMps: 8,
      previousTrackId: 'xo-1',
    })
    expect(stay?.placement.trackId).toBe('xo-1')
  })

  it('陡角渡線：車頭跟渡線走向差超過 60 度就不是在轉線', () => {
    // 渡線走向約 60.3 度。中點 (702, 103.5)：離渡線 0、離兩條中心線各 1.75
    const along = resolveVehiclePlacementAcrossAreas(areasWith(STEEP()), 702, 103.5, undefined, {
      headingRad: (60 * Math.PI) / 180,
      speedMps: 8,
    })
    expect(along?.placement.trackId).toBe('xo-1')
    const across = resolveVehiclePlacementAcrossAreas(areasWith(STEEP()), 702, 103.5, undefined, {
      headingRad: 0,
      speedMps: 8,
    })
    expect(across?.placement.trackId).not.toBe('xo-1')
  })

  it('停著時 heading 不可信：不用它擋渡線', () => {
    const p = resolveVehiclePlacementAcrossAreas(areasWith(STEEP()), 702, 103.5, undefined, {
      headingRad: 0,
      speedMps: 0,
    })
    expect(p?.placement.trackId).toBe('xo-1')
  })
})

describe('渡線的連續性：上一筆要真的傳進來', () => {
  it('previousTrackIdOf：渡線的結果也算，場區車位不算', () => {
    const onXo = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 103.5, undefined, {
      headingRad: 0.05,
      speedMps: 8,
    })
    // 渡線的結果沒有 network 欄位——只認 network 的呼叫端永遠拿不到渡線上一筆
    expect(onXo?.placement.network).toBeUndefined()
    expect(previousTrackIdOf(onXo, false)).toBe('xo-1')
    expect(previousTrackIdOf(onXo, true)).toBeUndefined()
    expect(previousTrackIdOf(null, false)).toBeUndefined()
  })

  it('上一筆在原軌道：渡線要更明顯地贏才搶', () => {
    // (700, 103.0)：離 D 1.25、離渡線約 0.5
    const opts = { headingRad: 0.05, speedMps: 8 }
    const fresh = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 103.0, undefined, opts)
    expect(fresh?.placement.trackId).toBe('xo-1')
    const stay = resolveVehiclePlacementAcrossAreas(areasWith(SHALLOW()), 700, 103.0, undefined, {
      ...opts,
      previousTrackId: 'D',
    })
    expect(stay?.placement.trackId).toBe('D')
  })

  it('沿著渡線一路開過去：逐筆帶上一筆，不在軌道與渡線之間來回跳', () => {
    const areas = areasWith(SHALLOW())
    const seen: string[] = []
    let last: ReturnType<typeof resolveVehiclePlacementAcrossAreas> = null
    // 沿渡線從 (655, 101.9) 走到 (745, 105.1)，每 5 公尺一筆，車頭順著渡線
    for (let x = 655; x <= 745; x += 5) {
      const y = 101.75 + ((x - 650) / 100) * 3.5
      last = resolveVehiclePlacementAcrossAreas(areas, x, y, undefined, {
        headingRad: Math.atan2(3.5, 100),
        speedMps: 8,
        previousTrackId: previousTrackIdOf(last, false),
      })
      seen.push(last!.placement.trackId)
    }
    // 換手次數：D → xo-1 → U，最多兩次，不能來回
    let switches = 0
    for (let i = 1; i < seen.length; i += 1) if (seen[i] !== seen[i - 1]) switches += 1
    expect(switches).toBeLessThanOrEqual(2)
    expect(seen.filter((t) => t === 'xo-1').length).toBeGreaterThan(seen.length / 2)
  })
})
