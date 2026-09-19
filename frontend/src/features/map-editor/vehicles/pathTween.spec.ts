import { describe, expect, it } from 'vitest'
import { buildTrackGenIndex } from '../utils/trackGenLocate'
import { pointAlongPath } from '../utils/trackGenPaths'
import { MAX_TWEEN_TRAVEL_M, planPathTween, samplePathTween } from './pathTween'

/**
 * 沿路徑補間。
 *
 * 補的是（哪一塊、走了幾成、偏了多少），每一幀再從那一塊的路徑取座標——所以這裡驗的
 * 是「沿線位置」怎麼走，不是畫面座標。
 */

type Pt = [number, number]
function piece(id: string, real: Pt[], h = 0) {
  return {
    id,
    parameters: {
      trackGenRealPath: real,
      trackGenLocalPath: real.map(([x, y]) => [x / 1000, y / 1000]),
      trackGenSpans: [{ road: id, lane: -1, s0: 0, s1: 100, h, f0: 0, f1: 1 }],
    },
  }
}

// a（50 公尺）→ b（50 公尺）→ c（50 公尺）接成一條；e 是遠處不相連的一塊
const index = buildTrackGenIndex([
  piece('a', [[0, 0], [50, 0]]),
  piece('b', [[50, 0], [100, 0]]),
  piece('c', [[100, 0], [150, 0]]),
  piece('e', [[0, 500], [50, 500]]),
])

describe('同一塊上補間', () => {
  const tween = planPathTween(
    index,
    { trackId: 'a', along: 0.2, side: 0 },
    { trackId: 'a', along: 0.6, side: 0.3 },
    1000,
    1000,
  )

  it('起點與終點', () => {
    expect(samplePathTween(tween, 1000).pose).toEqual({ trackId: 'a', along: 0.2, side: 0 })
    const end = samplePathTween(tween, 2000)
    expect(end.done).toBe(true)
    expect(end.pose).toEqual({ trackId: 'a', along: 0.6, side: 0.3 })
  })

  it('中間照比例走，沿線位置與偏差各自線性', () => {
    const mid = samplePathTween(tween, 1500)
    expect(mid.done).toBe(false)
    expect(mid.pose.trackId).toBe('a')
    expect(mid.pose.along).toBeCloseTo(0.4, 6)
    expect(mid.pose.side).toBeCloseTo(0.15, 6)
  })

  it('沿線位置單調，不倒退', () => {
    let last = -1
    for (let t = 1000; t <= 2000; t += 50) {
      const a = samplePathTween(tween, t).pose.along
      expect(a).toBeGreaterThanOrEqual(last)
      last = a
    }
  })
})

describe('換塊：沿相連的端點走', () => {
  // a 的 0.8 處 → b 的 0.4 處：先走完 a 剩下的 10 公尺，再從 b 的起點走 20 公尺
  const tween = planPathTween(
    index,
    { trackId: 'a', along: 0.8, side: 0 },
    { trackId: 'b', along: 0.4, side: 0 },
    0,
    3000,
  )

  it('分成兩段：走完上一塊的終點、從下一塊的起點接續', () => {
    expect(tween.steps).toHaveLength(2)
    expect(tween.steps![0]).toMatchObject({ trackId: 'a', a: 0.8, b: 1 })
    expect(tween.steps![1]).toMatchObject({ trackId: 'b', a: 0, b: 0.4 })
  })

  it('兩段的路程（10 公尺 vs 20 公尺），時間照路程分', () => {
    expect(tween.steps![0]!.lengthM).toBeCloseTo(10, 6)
    expect(tween.steps![1]!.lengthM).toBeCloseTo(20, 6)
  })

  it('前半在上一塊、後半在下一塊，中間經過接點', () => {
    const early = samplePathTween(tween, 500).pose
    expect(early.trackId).toBe('a')
    expect(early.along).toBeGreaterThan(0.8)
    expect(early.along).toBeLessThan(1)

    const late = samplePathTween(tween, 2000).pose
    expect(late.trackId).toBe('b')
    expect(late.along).toBeGreaterThan(0)
    expect(late.along).toBeLessThan(0.4)

    // 接點那一刻：上一塊走到頭
    const atJoin = samplePathTween(tween, 3000 * (10 / 30) - 1).pose
    expect(atJoin.trackId).toBe('a')
    expect(atJoin.along).toBeCloseTo(1, 1)
  })

  it('補完停在目標', () => {
    const end = samplePathTween(tween, 3000)
    expect(end.done).toBe(true)
    expect(end.pose).toEqual({ trackId: 'b', along: 0.4, side: 0 })
  })
})

describe('補不了的就直接到位，不要讓車飛過去', () => {
  it('兩塊不相連', () => {
    const t = planPathTween(
      index,
      { trackId: 'a', along: 0.5, side: 0 },
      { trackId: 'e', along: 0.5, side: 0 },
      0,
      1000,
    )
    expect(t.durationMs).toBe(0)
    expect(samplePathTween(t, 0)).toEqual({
      pose: { trackId: 'e', along: 0.5, side: 0 },
      done: true,
    })
  })

  it('同一塊但一次走太遠（重新發車、斷線很久）', () => {
    const long = buildTrackGenIndex([piece('long', [[0, 0], [1000, 0]])])
    const t = planPathTween(
      long,
      { trackId: 'long', along: 0.1, side: 0 },
      { trackId: 'long', along: 0.9, side: 0 },
      0,
      1000,
    )
    expect(0.8 * 1000).toBeGreaterThan(MAX_TWEEN_TRAVEL_M)
    expect(t.durationMs).toBe(0)
  })

  it('補間時長是 0（編輯模式）：直接到位', () => {
    const t = planPathTween(
      index,
      { trackId: 'a', along: 0.1, side: 0 },
      { trackId: 'a', along: 0.2, side: 0 },
      0,
      0,
    )
    expect(t.durationMs).toBe(0)
  })
})

describe('補到一半又來新資料：從畫面上現在的位置接著補', () => {
  it('新補間的起點是舊補間當下的位置，不是舊補間的終點', () => {
    const first = planPathTween(
      index,
      { trackId: 'a', along: 0, side: 0 },
      { trackId: 'a', along: 0.5, side: 0 },
      0,
      1000,
    )
    const shown = samplePathTween(first, 400).pose // 走到 0.2
    expect(shown.along).toBeCloseTo(0.2, 6)
    const second = planPathTween(index, shown, { trackId: 'a', along: 0.6, side: 0 }, 400, 1000)
    expect(samplePathTween(second, 400).pose.along).toBeCloseTo(0.2, 6)
  })
})

describe('彎道上不切出軌道（直線補間會）', () => {
  // 半徑 30 的四分之一圓，取兩個相隔 60 度的點補間
  const R = 30
  const arc: Pt[] = []
  for (let deg = 0; deg <= 90; deg += 3) {
    const a = (deg * Math.PI) / 180
    arc.push([R * Math.sin(a), R - R * Math.cos(a)])
  }
  const curved = buildTrackGenIndex([piece('arc', arc)])
  const fromAlong = 10 / 90
  const toAlong = 70 / 90

  const radiusAt = (t: { x: number; y: number }) => Math.hypot(t.x, t.y - R)

  it('沿線補間：每一幀離圓心都是半徑（一直在路上）', () => {
    const tween = planPathTween(
      curved,
      { trackId: 'arc', along: fromAlong, side: 0 },
      { trackId: 'arc', along: toAlong, side: 0 },
      0,
      1000,
    )
    let worst = 0
    for (let t = 0; t <= 1000; t += 25) {
      const pose = samplePathTween(tween, t).pose
      const p = pointAlongPath(arc, pose.along)
      worst = Math.max(worst, Math.abs(radiusAt(p) - R))
    }
    // 折線只有 3 度一段，弦高約 0.04 公尺
    expect(worst).toBeLessThan(0.1)
  })

  it('對照：兩個端點直接連弦，中點離軌道好幾公尺', () => {
    const a = pointAlongPath(arc, fromAlong)
    const b = pointAlongPath(arc, toAlong)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    // 60 度的弦，中點離圓周 R(1−cos30°)≈4 公尺
    expect(Math.abs(radiusAt(mid) - R)).toBeGreaterThan(3)
  })
})

describe('跨好幾塊：一秒的位移跨過中間的短路段', () => {
  // s1(10m) → s2(5m) → s3(10m) → s4(40m) 接成一條
  const chain = buildTrackGenIndex([
    piece('s1', [[0, 0], [10, 0]]),
    piece('s2', [[10, 0], [15, 0]]),
    piece('s3', [[15, 0], [25, 0]]),
    piece('s4', [[25, 0], [65, 0]]),
  ])

  it('隔一塊：沿中間那塊走過去', () => {
    const t = planPathTween(
      chain,
      { trackId: 's1', along: 0.5, side: 0 },
      { trackId: 's3', along: 0.5, side: 0 },
      0,
      1000,
    )
    expect(t.durationMs).toBe(1000)
    expect(t.steps!.map((s) => s.trackId)).toEqual(['s1', 's2', 's3'])
    // 5 + 5 + 5 公尺
    expect(t.steps!.reduce((n, s) => n + s.lengthM, 0)).toBeCloseTo(15, 6)
  })

  it('路程超過 80 公尺（a → c 共 100 公尺）：直接到位', () => {
    const t = planPathTween(
      index,
      { trackId: 'a', along: 0.5, side: 0 },
      { trackId: 'c', along: 0.5, side: 0 },
      0,
      1000,
    )
    expect(t.durationMs).toBe(0)
  })

  it('s1 → s4：三個接點都經過，沿線位置單調、每一幀都在某一塊上', () => {
    const t = planPathTween(
      chain,
      { trackId: 's1', along: 0.5, side: 0 },
      { trackId: 's4', along: 0.25, side: 0 },
      0,
      1000,
    )
    expect(t.steps!.map((s) => s.trackId)).toEqual(['s1', 's2', 's3', 's4'])
    const order = ['s1', 's2', 's3', 's4']
    let lastRank = 0
    let lastAlong = 0
    for (let ms = 0; ms <= 1000; ms += 20) {
      const pose = samplePathTween(t, ms).pose
      const rank = order.indexOf(pose.trackId)
      expect(rank).toBeGreaterThanOrEqual(lastRank)
      if (rank === lastRank) expect(pose.along).toBeGreaterThanOrEqual(lastAlong - 1e-9)
      lastRank = rank
      lastAlong = pose.along
    }
    expect(samplePathTween(t, 1000).pose).toEqual({ trackId: 's4', along: 0.25, side: 0 })
  })

  it('掉頭方向（終點在起點那塊的另一端）也找得到', () => {
    const t = planPathTween(
      chain,
      { trackId: 's3', along: 0.5, side: 0 },
      { trackId: 's1', along: 0.5, side: 0 },
      0,
      1000,
    )
    // 反著走：s3 從 0.5 走到 0、經 s2 整塊（10→15 反著）、到 s1 的 1.0 再走到 0.5
    expect(t.steps!.map((s) => s.trackId)).toEqual(['s3', 's2', 's1'])
    expect(t.steps![1]).toMatchObject({ a: 1, b: 0 })
  })

  it('超過跨塊上限就直接到位', () => {
    const long = buildTrackGenIndex(
      Array.from({ length: 8 }, (_, i) => piece(`p${i}`, [[i * 5, 0], [i * 5 + 5, 0]])),
    )
    const t = planPathTween(
      long,
      { trackId: 'p0', along: 0.5, side: 0 },
      { trackId: 'p7', along: 0.5, side: 0 },
      0,
      1000,
    )
    expect(t.durationMs).toBe(0)
  })
})
