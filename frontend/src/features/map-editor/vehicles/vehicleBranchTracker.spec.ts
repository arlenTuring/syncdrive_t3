import { describe, expect, it } from 'vitest'
import { STALE_GAP_MS, trackerNext, trackerPrior, type BranchTrackState, type TrackerFrame } from './vehicleBranchTracker'
import type { RoutePath } from './routeCorridor'

const frame = (over: Partial<TrackerFrame> = {}): TrackerFrame => ({
  t: 10_000,
  xM: 0,
  yM: 0,
  orderKey: 'O1',
  routeKey: 'O1|A>B',
  mapKey: 'm1',
  speedMps: 8,
  ...over,
})

const state = (over: Partial<BranchTrackState> = {}): BranchTrackState => ({
  branchId: 'd1',
  alongFrac: 0.5,
  xM: 0,
  yM: 0,
  t: 9_000,
  orderKey: 'O1',
  routeKey: 'O1|A>B',
  mapKey: 'm1',
  routeIndex: 0,
  ...over,
})

const path: RoutePath = { key: 'O1|A>B', stationIds: ['A', 'B'], branchIds: ['d1', 'd2', 'd3'], unresolvedStations: [] }

function expectReset(prior: ReturnType<typeof trackerPrior>, reason: string) {
  expect(prior.previousBranchId).toBeUndefined()
  expect(prior.resetReason).toBe(reason)
}

describe('什麼時候沿用上一筆的分支', () => {
  it('同一張任務、時間與位移合理：沿用分支與路徑進度', () => {
    expect(trackerPrior(state(), frame({ xM: 8 }))).toEqual({ previousBranchId: 'd1', routeIndex: 0, resetReason: null })
  })

  it('換圖：不沿用', () => {
    expectReset(trackerPrior(state(), frame({ mapKey: 'm2' })), 'map_changed')
  })

  it('換任務：不沿用', () => {
    expectReset(trackerPrior(state(), frame({ orderKey: 'O2' })), 'order_changed')
  })

  it('斷訊太久（重連）：不沿用', () => {
    expectReset(trackerPrior(state(), frame({ t: 9_000 + STALE_GAP_MS + 1 })), 'stale_gap')
  })

  it('位置跳變：不沿用', () => {
    expectReset(trackerPrior(state(), frame({ xM: 500 })), 'position_jump')
  })

  it('同一張任務但路線重算：分支沿用、路徑進度不沿用', () => {
    expect(trackerPrior(state(), frame({ routeKey: 'O1|A>C' }))).toEqual({
      previousBranchId: 'd1',
      routeIndex: null,
      resetReason: 'route_changed',
    })
  })
})

describe('狀態怎麼更新', () => {
  it('確認的判位：更新分支、位置、時間與路徑進度', () => {
    const f = frame({ xM: 60 })
    const next = trackerNext(state(), f, trackerPrior(state(), f), { branchId: 'd2', alongFrac: 0.1, confirmed: true }, path)
    expect(next).toMatchObject({ branchId: 'd2', xM: 60, t: 10_000, routeIndex: 1 })
  })

  it('分不開的那一筆不更新，狀態不被無限延續', () => {
    const s = state()
    const f = frame({ xM: 5 })
    const next = trackerNext(s, f, trackerPrior(s, f), { branchId: 'd9', alongFrac: 0.5, confirmed: false }, path)
    expect(next).toBe(s)
    // 之後一直分不開：上一筆確認的時刻不動，超過斷訊門檻就不再沿用
    expect(trackerPrior(next, frame({ t: s.t + STALE_GAP_MS + 1 })).previousBranchId).toBeUndefined()
  })

  it('換了任務又分不開：舊狀態直接丟掉', () => {
    const s = state()
    const f = frame({ orderKey: 'O2' })
    expect(trackerNext(s, f, trackerPrior(s, f), { branchId: 'd9', alongFrac: 0.5, confirmed: false }, null)).toBeUndefined()
  })
})
