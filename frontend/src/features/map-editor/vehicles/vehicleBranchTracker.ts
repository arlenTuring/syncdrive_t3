/**
 * 每台車跨時間的分支狀態。
 *
 * 判位本身只看「這一筆」；分不開的時候要靠上一筆確認的分支與任務路徑進度決定。這裡管
 * 那份狀態<strong>什麼時候還能信</strong>：
 *
 * <ul>
 *   <li>地圖換了、任務換了：分支 id 與路徑都可能對不上，整份丟掉重新定位。</li>
 *   <li>斷訊太久：上一筆已經不代表現在，丟掉。</li>
 *   <li>位置跳變：兩筆之間的位移超過合理範圍（重連、換車、座標跳動），丟掉。</li>
 *   <li>判位分不開（ambiguous）的那一筆不更新狀態，所以狀態不會被無限延續——上一筆
 *       確認的時刻不動，過了斷訊門檻自然失效。</li>
 * </ul>
 */

import { advanceRouteIndex, type RoutePath } from './routeCorridor'

export type BranchTrackState = {
  branchId: string
  alongFrac: number
  xM: number
  yM: number
  /** 這一筆確認的時刻（毫秒） */
  t: number
  /** 任務識別（訂單 id）；沒有任務時 null */
  orderKey: string | null
  /** 路線識別（RoutePath.key）；沒有路徑時 null */
  routeKey: string | null
  mapKey: string
  /** 在任務路徑的第幾條分支；沒有路徑或還沒對上時 null */
  routeIndex: number | null
}

export type TrackerFrame = {
  t: number
  xM: number
  yM: number
  orderKey: string | null
  routeKey: string | null
  mapKey: string
  /** 車端回報的車速（公尺／秒），估位移上限用 */
  speedMps: number | null
}

/** 超過這麼久沒有確認的判位，上一筆就不再當證據 */
export const STALE_GAP_MS = 15_000
/** 兩筆之間至少允許這麼多位移（公尺）：模擬倍速下每筆位移會放大，但遙測頻率也跟著提高 */
export const JUMP_MIN_M = 30

export type TrackerResetReason = 'none' | 'map_changed' | 'order_changed' | 'route_changed' | 'stale_gap' | 'position_jump'

export type TrackerPrior = {
  previousBranchId?: string
  routeIndex: number | null
  /** 為什麼沒有沿用上一筆；沿用時為 null */
  resetReason: TrackerResetReason | null
}

export function trackerPrior(state: BranchTrackState | undefined, frame: TrackerFrame): TrackerPrior {
  if (!state) return { routeIndex: null, resetReason: 'none' }
  if (state.mapKey !== frame.mapKey) return { routeIndex: null, resetReason: 'map_changed' }
  if (state.orderKey !== frame.orderKey) return { routeIndex: null, resetReason: 'order_changed' }
  const dt = frame.t - state.t
  if (dt > STALE_GAP_MS || dt < 0) return { routeIndex: null, resetReason: 'stale_gap' }
  const moved = Math.hypot(frame.xM - state.xM, frame.yM - state.yM)
  const limit = Math.max(JUMP_MIN_M, (frame.speedMps ?? 0) * (dt / 1000) * 2 + 10)
  if (moved > limit) return { routeIndex: null, resetReason: 'position_jump' }
  // 同一張任務但路線重算（站序變了）：分支還能用，路徑進度不能
  const routeIndex = state.routeKey === frame.routeKey ? state.routeIndex : null
  return {
    previousBranchId: state.branchId,
    routeIndex,
    resetReason: state.routeKey === frame.routeKey ? null : 'route_changed',
  }
}

export function trackerNext(
  state: BranchTrackState | undefined,
  frame: TrackerFrame,
  prior: TrackerPrior,
  result: { branchId: string; alongFrac: number; confirmed: boolean } | null,
  path: RoutePath | null,
): BranchTrackState | undefined {
  if (!result || !result.confirmed) {
    // 分不開的那一筆不更新；但地圖／任務已經換了的舊狀態不能留
    return prior.resetReason && prior.resetReason !== 'route_changed' && prior.resetReason !== 'none'
      ? undefined
      : state
  }
  return {
    branchId: result.branchId,
    alongFrac: result.alongFrac,
    xM: frame.xM,
    yM: frame.yM,
    t: frame.t,
    orderKey: frame.orderKey,
    routeKey: frame.routeKey,
    mapKey: frame.mapKey,
    routeIndex: path ? advanceRouteIndex(path, prior.routeIndex, result.branchId) : null,
  }
}
