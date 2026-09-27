import type { TrackGenIndex } from '../utils/trackGenLocate'
import { planPathTween, samplePathTween, type PathPose, type PathTween } from './pathTween'

/**
 * 遙測的緩衝播放（jitter buffer）。
 *
 * <h3>為什麼不能「收到一筆就朝它補 1.2 秒」</h3>
 * 車端每秒發一筆，時間戳很準（實測間隔 1005～1022 毫秒）；但送到瀏覽器的時間會抖：
 * 中心端忙的時候整批晚到，隔一下又連續到好幾筆（實測接收間隔 40～2300 毫秒）。
 * 以「收到的時刻」補間，晚到時車補完就停住等下一筆，下一筆一到又急著追上——
 * 畫面上就是一頓一頓的。
 *
 * 改成照<strong>車端的時間戳</strong>播：畫面時刻＝現在往回退「最近觀察到的最大延遲」，
 * 在這一刻前後兩筆之間沿路徑補。延遲只要不超過最近見過的最大值，就一定有下一筆可以補，
 * 車的速度也跟車端一樣均勻。代價是畫面比最新一筆晚一點（就是那個最大延遲）。
 *
 * <h3>倍速</h3>
 * 模擬器倍速時時間戳走得比牆上時間快。時間戳與接收時刻的比例（rate）由最近幾筆估出來；
 * 接近 1 就當 1，避免估計誤差讓畫面時刻忽快忽慢。
 */

export type PlayoutSample = {
  pose: PathPose
  /** 車端時間戳（毫秒） */
  sampleMs: number
  /** 瀏覽器收到的時刻（Date.now） */
  arrivalMs: number
  /** 從上一筆沿路徑走到這一筆的補間（第一筆沒有） */
  tween: PathTween | null
}

export type PlayoutState = { samples: PlayoutSample[] }

/** 留幾筆：夠估 rate、夠蓋過最大延遲即可 */
export const PLAYOUT_MAX_SAMPLES = 8
/** 最大延遲之外再退的餘裕（毫秒） */
export const PLAYOUT_MARGIN_MS = 120
/** 時間戳與接收時刻比例在這個範圍內就當即時（1 倍） */
const REALTIME_RATE_TOLERANCE = 0.12

export function createPlayoutState(pose: PathPose, sampleMs: number, arrivalMs: number): PlayoutState {
  return { samples: [{ pose, sampleMs, arrivalMs, tween: null }] }
}

/**
 * 收一筆新樣本。時間戳沒有往前（重送、亂序）就不收。
 * 補間的起訖就是兩筆的時間戳，所以之後照時間戳取樣自然是均速。
 */
export function pushPlayoutSample(
  index: TrackGenIndex,
  state: PlayoutState,
  pose: PathPose,
  sampleMs: number,
  arrivalMs: number,
): void {
  const last = state.samples[state.samples.length - 1]
  if (last && sampleMs <= last.sampleMs) return
  const tween = last
    ? planPathTween(index, last.pose, pose, last.sampleMs, sampleMs - last.sampleMs)
    : null
  state.samples.push({ pose, sampleMs, arrivalMs, tween })
  if (state.samples.length > PLAYOUT_MAX_SAMPLES) {
    state.samples.splice(0, state.samples.length - PLAYOUT_MAX_SAMPLES)
  }
}

/** 車端時間戳每過 1 毫秒，牆上時間過幾分之一（倍速時 >1） */
export function estimatePlayoutRate(samples: readonly PlayoutSample[]): number {
  if (samples.length < 3) return 1
  const first = samples[0]!
  const last = samples[samples.length - 1]!
  const spanSample = last.sampleMs - first.sampleMs
  const spanArrival = last.arrivalMs - first.arrivalMs
  if (!(spanSample > 0) || !(spanArrival > 0)) return 1
  const rate = Math.max(0.05, Math.min(200, spanSample / spanArrival))
  return Math.abs(rate - 1) <= REALTIME_RATE_TOLERANCE ? 1 : rate
}

/** 這一刻該畫的位置；animating＝還在兩筆之間（需要繼續排下一幀） */
export function resolvePlayoutPose(
  state: PlayoutState,
  nowMs: number,
): { pose: PathPose; animating: boolean } {
  const samples = state.samples
  const last = samples[samples.length - 1]!
  if (samples.length === 1) return { pose: last.pose, animating: false }

  const rate = estimatePlayoutRate(samples)
  // 延遲包絡：最近幾筆「收到時刻 − 換算成牆上時間的時間戳」的最大值
  let lag = -Infinity
  for (const sample of samples) lag = Math.max(lag, sample.arrivalMs - sample.sampleMs / rate)
  const displayMs = (nowMs - lag - PLAYOUT_MARGIN_MS) * rate

  if (displayMs >= last.sampleMs) return { pose: last.pose, animating: false }
  const first = samples[0]!
  if (displayMs <= first.sampleMs) return { pose: first.pose, animating: true }
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const prev = samples[i - 1]!
    const next = samples[i]!
    if (displayMs >= prev.sampleMs && displayMs < next.sampleMs) {
      const pose = next.tween ? samplePathTween(next.tween, displayMs).pose : next.pose
      return { pose, animating: true }
    }
  }
  return { pose: last.pose, animating: false }
}

/** 遙測的時間戳（毫秒）；數字或 ISO 字串都收，沒有就回 null */
export function readTelemetrySampleMs(payload: Record<string, unknown> | undefined): number | null {
  const raw = payload?.timestamp
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const numeric = Number(raw)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}
