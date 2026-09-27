import { describe, expect, it } from 'vitest'
import { buildTrackGenIndex } from '../utils/trackGenLocate'
import {
  createPlayoutState,
  estimatePlayoutRate,
  pushPlayoutSample,
  readTelemetrySampleMs,
  resolvePlayoutPose,
} from './pathPlayout'

/**
 * 遙測緩衝播放：車端每秒一筆、時間戳準；送達時間抖（整批晚到、又連續到）。
 * 畫面要照時間戳均速走，不能「補完停住、下一筆到了再追」。
 */

type Pt = [number, number]
function piece(id: string, real: Pt[]) {
  return {
    id,
    parameters: {
      trackGenRealPath: real,
      trackGenLocalPath: real.map(([x, y]) => [x / 1000, y / 1000]),
      trackGenSpans: [{ road: id, lane: -1, s0: 0, s1: 100, h: 0, f0: 0, f1: 1 }],
    },
  }
}

// 一塊 200 公尺的直線；車每秒走 8 公尺＝along 每秒 +0.04
const index = buildTrackGenIndex([piece('a', [[0, 0], [200, 0]])])
const pose = (along: number) => ({ trackId: 'a', along, side: 0 })

describe('送達時間抖動時照時間戳均速播放', () => {
  // 時間戳每 1000 毫秒一筆；送達：第 3、4 筆晚了 700 毫秒一起到（實測的整批晚到）
  const T0 = 1_000_000
  const arrivals = [0, 1000, 2700, 2710, 4000, 5000, 6000]
  const state = createPlayoutState(pose(0), T0, T0 + 50)
  for (let i = 1; i < arrivals.length; i += 1) {
    pushPlayoutSample(index, state, pose(0.04 * i), T0 + 1000 * i, T0 + 50 + arrivals[i]!)
  }

  it('時間戳跟送達同速：rate 當 1', () => {
    expect(estimatePlayoutRate(state.samples)).toBe(1)
  })

  it('每一幀的位置隨時間均勻前進，不會停住再追', () => {
    const positions: number[] = []
    // 從第一筆晚到的那一刻起逐 100 毫秒取樣，直到最後一筆資料播完為止：
    // 延遲包絡（750 毫秒）＋餘裕，播放點一直落在兩筆之間，每一步都一樣長
    for (let t = 2750; t <= 6800; t += 100) {
      positions.push(resolvePlayoutPose(state, T0 + t).pose.along)
    }
    const steps = positions.slice(1).map((p, i) => p - positions[i]!)
    for (const d of steps) expect(d).toBeCloseTo(0.004, 3)
  })
})

describe('倍速：時間戳走得比牆上時間快', () => {
  it('估出倍速，照比例播放', () => {
    const T0 = 5_000_000
    const state = createPlayoutState(pose(0), T0, T0)
    // 20 倍速：時間戳每筆 +1000，牆上時間每筆 +50
    for (let i = 1; i <= 6; i += 1) pushPlayoutSample(index, state, pose(0.04 * i), T0 + 1000 * i, T0 + 50 * i)
    expect(estimatePlayoutRate(state.samples)).toBeCloseTo(20, 5)
    const a = resolvePlayoutPose(state, T0 + 300).pose.along
    const b = resolvePlayoutPose(state, T0 + 350).pose.along
    // 牆上 50 毫秒＝車端 1000 毫秒＝一筆的距離
    expect(b - a).toBeCloseTo(0.04, 3)
  })
})

describe('其他', () => {
  it('重送或亂序（時間戳沒往前）的樣本不收', () => {
    const state = createPlayoutState(pose(0), 1000, 1000)
    pushPlayoutSample(index, state, pose(0.04), 2000, 2000)
    pushPlayoutSample(index, state, pose(0.5), 1500, 2100)
    expect(state.samples.map((s) => s.sampleMs)).toEqual([1000, 2000])
  })

  it('時間戳：數字、數字字串、ISO 字串都收，沒有就 null', () => {
    expect(readTelemetrySampleMs({ timestamp: 1790000000000 })).toBe(1790000000000)
    expect(readTelemetrySampleMs({ timestamp: '1790000000000' })).toBe(1790000000000)
    expect(readTelemetrySampleMs({ timestamp: '2026-09-27T08:00:00.000Z' })).toBe(Date.parse('2026-09-27T08:00:00.000Z'))
    expect(readTelemetrySampleMs({})).toBeNull()
  })
})
