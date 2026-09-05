/**
 * 生成軌道的投影路徑。
 *
 * 車輛回報的是真實場域座標，圖台要把它畫在簡易地圖上。通用的做法是把座標對到
 * 元件的參照場域範圍、沿長邊做線性內插——直線段沒問題，圓角是一段弧就對不上：
 * 實測車子走到轉角會跳 137 像素。
 *
 * 所以生成時把兩條中心線一起存下來：真實路徑與對應的圖面路徑。投影時先在真實
 * 路徑上求出「走了幾成」，再照同樣的比例落在圖面路徑上，弧與斜段都會貼合。
 *
 * 圖面路徑存的是<strong>未旋轉外框的 0–1 比例</strong>，所以元件之後被拉伸、Area 被
 * 縮放都不影響。
 */

/** 真實中心線，[[x, y], …]，依里程由小到大 */
export const TRACKGEN_REAL_PATH_KEY = 'trackGenRealPath'
/** 圖面中心線，[[u, v], …]，與真實路徑同順序 */
export const TRACKGEN_LOCAL_PATH_KEY = 'trackGenLocalPath'
/**
 * 這一塊代表的路網區間：`[{ road, lane, s0, s1 }, …]`。
 *
 * 車輛回報場域座標，反投影回 OpenDRIVE 得到 road / lane / s，照這份清單就能直接查到
 * 該畫在哪一塊，不必拿座標跟每一塊軌道比距離。路口的元件會有不只一筆。
 */
export const TRACKGEN_SPANS_KEY = 'trackGenSpans'

export type TrackGenSpan = { road: string; lane: number; s0: number; s1: number }

export function getTrackGenSpans(
  parameters: Record<string, unknown> | undefined,
): TrackGenSpan[] {
  const raw = parameters?.[TRACKGEN_SPANS_KEY]
  if (!Array.isArray(raw)) return []
  const out: TrackGenSpan[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const road = typeof o.road === 'string' ? o.road : null
    const lane = Number(o.lane)
    const s0 = Number(o.s0)
    const s1 = Number(o.s1)
    if (!road || ![lane, s0, s1].every(Number.isFinite)) continue
    out.push({ road, lane, s0: Math.min(s0, s1), s1: Math.max(s0, s1) })
  }
  return out
}

export type PathXY = Array<[number, number]>

function readPath(raw: unknown): PathXY | null {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const out: PathXY = []
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null
    const x = Number(p[0])
    const y = Number(p[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    out.push([x, y])
  }
  return out
}

export function getTrackGenPaths(
  parameters: Record<string, unknown> | undefined,
): { real: PathXY; local: PathXY } | null {
  const real = readPath(parameters?.[TRACKGEN_REAL_PATH_KEY])
  const local = readPath(parameters?.[TRACKGEN_LOCAL_PATH_KEY])
  if (!real || !local) return null
  return { real, local }
}

function cumulative(path: PathXY): number[] {
  const seg: number[] = [0]
  for (let i = 1; i < path.length; i += 1) {
    seg.push(
      seg[i - 1]! +
        Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]),
    )
  }
  return seg
}

/** 點投影到折線上，回傳沿線走了幾成（0–1）與距離 */
export function projectAlongPath(
  path: PathXY,
  x: number,
  y: number,
): { along: number; distance: number } {
  const seg = cumulative(path)
  const total = seg[seg.length - 1]!
  if (!(total > 0)) {
    return { along: 0, distance: Math.hypot(x - path[0]![0], y - path[0]![1]) }
  }

  let bestS = 0
  let bestD = Infinity
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1]![0]
    const ay = path[i - 1]![1]
    const dx = path[i]![0] - ax
    const dy = path[i]![1] - ay
    const l2 = dx * dx + dy * dy
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    const qx = ax + dx * u
    const qy = ay + dy * u
    const d = Math.hypot(x - qx, y - qy)
    if (d < bestD) {
      bestD = d
      bestS = seg[i - 1]! + u * Math.sqrt(l2)
    }
  }
  return { along: bestS / total, distance: bestD }
}

/** 沿折線取「走了幾成」的位置 */
export function pointAlongPath(path: PathXY, along: number): { x: number; y: number } {
  const seg = cumulative(path)
  const total = seg[seg.length - 1]!
  if (!(total > 0)) return { x: path[0]![0], y: path[0]![1] }
  const target = Math.max(0, Math.min(1, along)) * total
  for (let i = 1; i < path.length; i += 1) {
    if (seg[i]! >= target) {
      const span = Math.max(1e-9, seg[i]! - seg[i - 1]!)
      const u = (target - seg[i - 1]!) / span
      return {
        x: path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * u,
        y: path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * u,
      }
    }
  }
  const last = path[path.length - 1]!
  return { x: last[0], y: last[1] }
}

/**
 * 重疊時的取捨分數：越小越優先。
 *
 * 參照場域範圍是外接方框，分岔處必然互相重疊；只比距離的話，岔出去那條與直行那條
 * 在分岔點上等距，車子會在某一格突然跳過去再跳回來——實測跳了 19 像素。
 *
 * 分不出來時<strong>偏向比較長的那一條線</strong>。這是資料本身的性質（哪一條串得比較
 * 長），不是「哪一條是主線」這種外部知識；短短一段岔線要贏，得靠車子真的明顯
 * 靠過去。優勢上限 0.75 公尺，兩公里以上的線才拿滿。
 */
export const LONG_LINE_BONUS_M = 0.75
const LONG_LINE_FULL_M = 2000

export function trackGenPickScore(
  parameters: Record<string, unknown> | undefined,
  xM: number,
  yM: number,
): number | null {
  const paths = getTrackGenPaths(parameters)
  if (!paths) return null
  const { distance } = projectAlongPath(paths.real, xM, yM)
  const raw = parameters?.trackGenLineLengthM
  const lineLen = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  const bonus = Math.min(1, lineLen / LONG_LINE_FULL_M) * LONG_LINE_BONUS_M
  return distance - bonus
}
