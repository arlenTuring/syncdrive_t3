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
 * 改成照<strong>車端的時間戳</strong>播：畫面時刻＝現在往回退「最大送達延遲＋一個樣本間隔」，
 * 在這一刻前後兩筆之間沿路徑補。
 *
 * <strong>一定要多退一個樣本間隔。</strong>第 N 筆送到之後、第 N+1 筆送到之前，畫面最多只能
 * 播到第 N 筆；第 N+1 筆在「它的時間戳＋延遲」才到，所以畫面至少要落後
 * 「延遲＋兩筆的間隔」。只退延遲（約 10 毫秒）的話，新的一筆一到畫面就跳到兩筆間 9 成的
 * 位置、滑一百多毫秒就追上最新一筆停住——車每秒瞬移一次（2026-09-27 影片實測）。
 * 代價是畫面比最新一筆晚約一個間隔（遙測一秒一筆就晚一秒多），跟原本補 1.2 秒差不多。
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

/** 樣本間隔（車端時間戳，毫秒）：取中位數，偶爾斷訊一次的長間隔不會把畫面延遲拉長 */
export function estimatePlayoutIntervalMs(samples: readonly PlayoutSample[]): number {
  const gaps: number[] = []
  for (let i = 1; i < samples.length; i += 1) gaps.push(samples[i]!.sampleMs - samples[i - 1]!.sampleMs)
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
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
  // 再退一個樣本間隔：下一筆送到之前，畫面還在上一段中間（見檔頭）
  const intervalWallMs = estimatePlayoutIntervalMs(samples) / rate
  const displayMs = (nowMs - lag - intervalWallMs - PLAYOUT_MARGIN_MS) * rate

  if (displayMs >= last.sampleMs) return { pose: last.pose, animating: false }
  const first = samples[0]!
  if (displayMs <= first.sampleMs) return { pose: first.pose, animating: stillMovingFrom(samples, 0) }
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const prev = samples[i - 1]!
    const next = samples[i]!
    if (displayMs >= prev.sampleMs && displayMs < next.sampleMs) {
      const pose = next.tween ? samplePathTween(next.tween, displayMs).pose : next.pose
      return { pose, animating: stillMovingFrom(samples, i - 1) }
    }
  }
  return { pose: last.pose, animating: false }
}

function samePose(a: PathPose, b: PathPose): boolean {
  return a.trackId === b.trackId && a.along === b.along && a.side === b.side
}

/**
 * 從第 from 筆起還有沒有位置變化。停站的車不必每幀重畫；新的一筆送到時畫面本來就會重畫，
 * 那時再判斷一次，起步不會漏掉。
 */
function stillMovingFrom(samples: readonly PlayoutSample[], from: number): boolean {
  const base = samples[from]!.pose
  for (let i = from + 1; i < samples.length; i += 1) {
    if (!samePose(samples[i]!.pose, base)) return true
  }
  return false
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
