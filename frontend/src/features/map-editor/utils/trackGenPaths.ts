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
 * 橫向比例尺，換算成「佔外框的幾分之幾」。
 *
 * 存兩個數字（沿外框的寬、沿外框的高各一），因為外框不見得是正方形；圖面路徑的法線
 * 有兩個分量，各乘各的才不會把偏移量拉歪。存比例而不是像素，元件被移動、拉伸都不影響。
 */
export const TRACKGEN_LAT_PER_BOX_KEY = 'trackGenLatPerBox'
/**
 * 偏移量<strong>往哪個方向</strong>移出去。
 *
 * <code>axis</code>：沿外框的橫軸。並排的軌道是照這個方向疊起來的，所以往這裡移才會
 * 落在隔壁那條上。斜接的中心線是斜的，若改用「垂直於中心線」，偏移量會同時把點沿著
 * 斜線推走——實測 3.5 公尺的偏移偏掉 8.2 像素，正好是 26 × sin(18.4°)。
 *
 * <code>arc</code>：垂直於中心線。圓角的並排軌道是同心弧，同心的方向就是法線方向。
 */
export const TRACKGEN_LAT_MODE_KEY = 'trackGenLatMode'
export type TrackGenLatMode = 'axis' | 'arc'
/**
 * 這一塊代表的路網區間：`[{ road, lane, s0, s1 }, …]`。
 *
 * 車輛回報場域座標，反投影回 OpenDRIVE 得到 road / lane / s，照這份清單就能直接查到
 * 該畫在哪一塊，不必拿座標跟每一塊軌道比距離。路口的元件會有不只一筆。
 */
export const TRACKGEN_SPANS_KEY = 'trackGenSpans'

export type TrackGenSpan = {
  road: string
  lane: number
  s0: number
  s1: number
  /** 這一段的行車方向（弳度，真實座標）；舊資料沒有時為 null */
  h: number | null
  /** 里程照路徑順序記，s0 可能大於 s1 */
  /** 這一段對應到這塊路徑的哪一截（0–1）；舊資料沒有時視為整條 */
  f0: number
  f1: number
}

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
    const h = Number(o.h)
    const f0 = Number(o.f0)
    const f1 = Number(o.f1)
    out.push({
      road,
      lane,
      s0,
      s1,
      h: Number.isFinite(h) ? h : null,
      f0: Number.isFinite(f0) ? f0 : 0,
      f1: Number.isFinite(f1) ? f1 : 1,
    })
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

export function getTrackGenLatMode(
  parameters: Record<string, unknown> | undefined,
): TrackGenLatMode {
  return parameters?.[TRACKGEN_LAT_MODE_KEY] === 'arc' ? 'arc' : 'axis'
}

/** 每公尺的橫向偏移佔外框的幾分之幾（沿寬、沿高） */
export function getTrackGenLatPerBox(
  parameters: Record<string, unknown> | undefined,
): [number, number] | null {
  const raw = parameters?.[TRACKGEN_LAT_PER_BOX_KEY]
  if (!Array.isArray(raw) || raw.length < 2) return null
  const u = Number(raw[0])
  const v = Number(raw[1])
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  return [u, v]
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

/**
 * 投影到折線上，可以只<strong>看其中一截</strong>。
 *
 * 路口的元件一塊要代表好幾段路網（圓角接兩條腿、分岔接梗與岔出），每一段各佔路徑的
 * 一截。距離若照<strong>整條</strong>路徑量，同一塊的每一段都會算出一模一樣的距離，
 * 誰先建立誰就贏——車子明明在岔出那條腿上，回報的卻是梗那條 road 的里程。
 *
 * 給了 range 就只在那一截上找最近點，於是「一段路網一個候選」，比較才有意義。
 * 回傳的 along 仍然是<strong>整條路徑</strong>的比例，取位置時不必再換算。
 *
 * <h3>偏移量帶正負號</h3>
 * <code>side</code> 是「離這條線多遠、偏哪一邊」（正號在前進方向的左手邊）。
 * 這個數字<strong>必須留著</strong>：車子不一定走在軌道上，它可能偏出去、跑到對向、
 * 撞上牆。只回傳距離、把車壓到線上，等於把「它偏掉了」這件事丟掉，圖上永遠是一台
 * 乖乖走在軌道上的車。
 */
export function projectAlongPath(
  path: PathXY,
  x: number,
  y: number,
  range?: { from: number; to: number },
): { along: number; distance: number; side: number } {
  const seg = cumulative(path)
  const total = seg[seg.length - 1]!
  if (!(total > 0)) {
    const d = Math.hypot(x - path[0]![0], y - path[0]![1])
    return { along: 0, distance: d, side: d }
  }
  const lo = range ? Math.max(0, Math.min(1, range.from)) * total : 0
  const hi = range ? Math.max(0, Math.min(1, range.to)) * total : total
  const [winLo, winHi] = lo <= hi ? [lo, hi] : [hi, lo]

  let bestS = winLo
  let bestD = Infinity
  let bestSide = 0
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1]![0]
    const ay = path[i - 1]![1]
    const dx = path[i]![0] - ax
    const dy = path[i]![1] - ay
    const l2 = dx * dx + dy * dy
    const len = Math.sqrt(l2)
    // 這一段落在視窗內的那一截（比例），完全在視窗外就跳過
    let uLo = 0
    let uHi = 1
    if (range && len > 1e-9) {
      uLo = Math.max(0, Math.min(1, (winLo - seg[i - 1]!) / len))
      uHi = Math.max(0, Math.min(1, (winHi - seg[i - 1]!) / len))
      if (uHi <= uLo && seg[i]! < winLo) continue
      if (uHi <= uLo && seg[i - 1]! > winHi) continue
    }
    const raw = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
    const u = Math.max(uLo, Math.min(uHi, raw))
    const qx = ax + dx * u
    const qy = ay + dy * u
    const d = Math.hypot(x - qx, y - qy)
    if (d < bestD) {
      bestD = d
      bestS = seg[i - 1]! + u * len
      // 左手邊為正：把點放進「這一段自己的座標系」看它在線的哪一側
      bestSide = len > 1e-9 ? (-(x - ax) * dy + (y - ay) * dx) / len : 0
    }
  }
  return { along: bestS / total, distance: bestD, side: bestSide }
}

/** 沿折線取「走了幾成」處的行進方向（單位向量） */
export function tangentAlongPath(path: PathXY, along: number): { x: number; y: number } {
  const seg = cumulative(path)
  const total = seg[seg.length - 1]!
  if (!(total > 0) || path.length < 2) return { x: 1, y: 0 }
  const target = Math.max(0, Math.min(1, along)) * total
  let i = path.length - 1
  for (let k = 1; k < path.length; k += 1) {
    if (seg[k]! >= target) {
      i = k
      break
    }
  }
  const dx = path[i]![0] - path[i - 1]![0]
  const dy = path[i]![1] - path[i - 1]![1]
  const len = Math.hypot(dx, dy)
  return len > 1e-9 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
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
