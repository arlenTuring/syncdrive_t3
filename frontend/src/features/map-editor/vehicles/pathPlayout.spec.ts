import { describe, expect, it } from 'vitest'
import { buildTrackGenIndex } from '../utils/trackGenLocate'
import {
  createPlayoutState,
  estimatePlayoutRate,
  pushPlayoutSample,
  readTelemetrySampleMs,
  resolvePlayoutPose,
  type PlayoutState,
} from './pathPlayout'

/**
 * 遙測緩衝播放：車端每秒一筆、時間戳準；送達時間抖（整批晚到、又連續到）。
 * 畫面要照時間戳均速走，不能「補完停住、下一筆到了再跳」。
 *
 * 測法跟畫面一樣：牆上時間每 33 毫秒畫一幀，畫之前先把「這一刻已經送到」的樣本收進來。
 * 只在資料全部送到之後取樣會看不到「新的一筆一到就跳」——2026-09-27 就是這樣漏掉的。
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

// 一塊 2000 公尺的直線；車每秒走 8 公尺＝along 每秒 +0.004
const index = buildTrackGenIndex([piece('a', [[0, 0], [2000, 0]])])
const pose = (along: number) => ({ trackId: 'a', along, side: 0 })
const STEP = 0.004

/** 逐幀播放：回傳每一幀的 along（從 fromMs 起，到 toMs 為止） */
function playFrames(
  samples: Array<{ sampleMs: number; arrivalMs: number; along: number }>,
  fromMs: number,
  toMs: number,
): number[] {
  let state: PlayoutState | null = null
  let next = 0
  const frames: number[] = []
  for (let t = samples[0]!.arrivalMs; t <= toMs; t += 33) {
    while (next < samples.length && samples[next]!.arrivalMs <= t) {
      const s = samples[next]!
      if (!state) state = createPlayoutState(pose(s.along), s.sampleMs, s.arrivalMs)
      else pushPlayoutSample(index, state, pose(s.along), s.sampleMs, s.arrivalMs)
      next += 1
    }
    if (state && t >= fromMs) frames.push(resolvePlayoutPose(state, t).pose.along)
  }
  return frames
}

function stepsOf(frames: number[]): number[] {
  return frames.slice(1).map((p, i) => p - frames[i]!)
}

describe('實際畫面：逐幀播放、樣本陸續送到', () => {
  const T0 = 1_790_000_000_000

  it('穩定每秒一筆、延遲 10 毫秒：每一幀都前進、速度均勻，沒有每秒一跳', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      sampleMs: T0 + 1000 * i,
      arrivalMs: T0 + 1000 * i + 10,
      along: STEP * i,
    }))
    const steps = stepsOf(playFrames(samples, T0 + 4000, T0 + 18_000))
    const perFrame = STEP * (33 / 1000)
    for (const d of steps) {
      expect(d).toBeGreaterThan(perFrame * 0.5)
      expect(d).toBeLessThan(perFrame * 1.5)
    }
  })

  it('送達時間抖（0～700 毫秒、整批晚到）：一樣均速', () => {
    const jitter = [0, 30, 700, 10, 650, 20, 400, 5, 690, 40, 300, 15, 600, 25, 350, 10, 700, 20, 50, 10]
    const samples = jitter.map((j, i) => ({
      sampleMs: T0 + 1000 * i,
      arrivalMs: T0 + 1000 * i + j,
      along: STEP * i,
    }))
    const steps = stepsOf(playFrames(samples, T0 + 8000, T0 + 19_000))
    const perFrame = STEP * (33 / 1000)
    for (const d of steps) {
      expect(d).toBeGreaterThan(perFrame * 0.5)
      expect(d).toBeLessThan(perFrame * 1.5)
    }
  })

  it('倍速 20 倍：估出倍速，一樣連續', () => {
    // 時間戳每筆 +1000，牆上時間每筆 +50
    const samples = Array.from({ length: 40 }, (_, i) => ({
      sampleMs: T0 + 1000 * i,
      arrivalMs: T0 + 50 * i + 5,
      along: STEP * i,
    }))
    const frames = playFrames(samples, T0 + 600, T0 + 1900)
    const steps = stepsOf(frames)
    // 牆上 33 毫秒＝車端 660 毫秒
    const perFrame = STEP * 0.66
    for (const d of steps) {
      expect(d).toBeGreaterThan(perFrame * 0.5)
      expect(d).toBeLessThan(perFrame * 1.5)
    }
  })
})

describe('停站', () => {
  it('停著不動不排下一幀；再開動（新的一筆送到）就恢復', () => {
    const T0 = 7_000_000
    const state = createPlayoutState(pose(0.1), T0, T0 + 10)
    for (let i = 1; i <= 4; i += 1) pushPlayoutSample(index, state, pose(0.1), T0 + 1000 * i, T0 + 1000 * i + 10)
    expect(resolvePlayoutPose(state, T0 + 4500).animating).toBe(false)
    pushPlayoutSample(index, state, pose(0.104), T0 + 5000, T0 + 5010)
    const r = resolvePlayoutPose(state, T0 + 5010)
    expect(r.pose.along).toBeCloseTo(0.1, 6)
    expect(r.animating).toBe(true)
  })
})

describe('倍速估計', () => {
  it('時間戳跟送達同速當 1；20 倍速估出 20', () => {
    const T0 = 5_000_000
    const same = createPlayoutState(pose(0), T0, T0)
    for (let i = 1; i <= 6; i += 1) pushPlayoutSample(index, same, pose(STEP * i), T0 + 1000 * i, T0 + 1000 * i + (i % 2) * 40)
    expect(estimatePlayoutRate(same.samples)).toBe(1)

    const fast = createPlayoutState(pose(0), T0, T0)
    for (let i = 1; i <= 6; i += 1) pushPlayoutSample(index, fast, pose(STEP * i), T0 + 1000 * i, T0 + 50 * i)
    expect(estimatePlayoutRate(fast.samples)).toBeCloseTo(20, 5)
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
