import {
  getTrackGenPaths,
  getTrackGenSpans,
  pointAlongPath,
  projectAlongPath,
  type PathXY,
} from './trackGenPaths'

/**
 * 車輛定位：場域座標 → 圖面位置。
 *
 * 座標算出格號拿到候選，投影到每一塊的真實中心線，取最近的一塊；road / lane / 里程
 * 是順帶回報的，不參與決定位置。偏移量帶正負號，畫的時候照它往旁邊移出去。
 */

export type LocateFacility = {
  id: string
  parameters?: Record<string, unknown>
}

type Piece = {
  facilityId: string
  road: string
  lane: number
  s0: number
  s1: number
  /** 這一段對應到 real/local 路徑的哪一截 */
  f0: number
  f1: number
  real: PathXY
  local: PathXY
  /**
   * 這條車道的<strong>行車方向</strong>（弳度），用來跟車頭朝向比對。
   */
  travelRad: number
}

export type TrackGenIndex = {
  cellM: number
  /** 格號 → 這一格裡有哪幾塊（pieces 的索引） */
  grid: Map<string, number[]>
  pieces: Piece[]
}

const cellKey = (cx: number, cy: number) => `${cx}|${cy}`

/**
 * 格子多大。
 *
 * 太大則每格候選變多、白算；太小則同一塊要登記進很多格。取分段長度的中位數，
 * 那是這份圖自己的尺度——換一份路網或換一個「一塊代表幾公尺」都會跟著調整。
 */
function cellSizeFor(pieces: Piece[]): number {
  const lens = pieces
    .map((p) => Math.abs(p.s1 - p.s0))
    .filter((v) => v > 0.1)
    .sort((a, b) => a - b)
  if (!lens.length) return 20
  return Math.max(5, Math.min(100, lens[Math.floor(lens.length / 2)]!))
}

export function buildTrackGenIndex(facilities: LocateFacility[]): TrackGenIndex {
  const pieces: Piece[] = []
  for (const f of facilities) {
    const paths = getTrackGenPaths(f.parameters)
    if (!paths) continue
    const spans = getTrackGenSpans(f.parameters)
    if (!spans.length) continue
    const a = paths.real[0]!
    const b = paths.real[paths.real.length - 1]!
    const alongS = Math.atan2(b[1] - a[1], b[0] - a[0])
    for (const sp of spans) {
      pieces.push({
        facilityId: f.id,
        road: sp.road,
        lane: sp.lane,
        s0: sp.s0,
        s1: sp.s1,
        f0: sp.f0,
        f1: sp.f1,
        real: paths.real,
        local: paths.local,
        // 逐段記的方向優先；舊資料沒有時退回整塊的頭尾連線
        travelRad: sp.h ?? (sp.lane > 0 ? alongS + Math.PI : alongS),
      })
    }
  }

  const cellM = cellSizeFor(pieces)
  const grid = new Map<string, number[]>()
  pieces.forEach((p, i) => {
    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (const [x, y] of p.real) {
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
    if (!Number.isFinite(xMin)) return
    // 帶子有寬度，格子往外放一格才不會在邊界上漏掉
    for (let cx = Math.floor(xMin / cellM) - 1; cx <= Math.floor(xMax / cellM) + 1; cx += 1) {
      for (let cy = Math.floor(yMin / cellM) - 1; cy <= Math.floor(yMax / cellM) + 1; cy += 1) {
        const k = cellKey(cx, cy)
        const arr = grid.get(k)
        if (arr) arr.push(i)
        else grid.set(k, [i])
      }
    }
  })

  return { cellM, grid, pieces }
}

export type Located = {
  facilityId: string
  road: string
  lane: number
  /** 沿該 road 參考線的里程（公尺） */
  sM: number
  /** 在這一塊上走了幾成，圖面位置照這個比例取 */
  along: number
  /** 圖面中心線上的位置（未旋轉外框的 0–1 比例） */
  local: { x: number; y: number }
  /**
   * 離該段真實中心線多遠（公尺），<strong>帶正負號</strong>：正號在行進方向的左手邊。
   */
  offsetM: number
}

/** 這一段自己那一截裡走了幾成——路口的元件橫跨兩條腿，里程要照各自那一截換算 */
/**
 * 兩個角度差多少（0–π）。
 *
 * JavaScript 的 % 會保留被除數的正負號，所以先取模再位移那種寫法在負角度上會算出負值，
 * 判斷「差超過 90 度」就整個失效——實測反方向那條車道的角差被算成 −3.1，比門檻小，
 * 於是完全沒被篩掉。先歸一到 0–2π 再折回來才對。
 */
function spanFrac(p: { f0: number; f1: number }, along: number): number {
  const w = p.f1 - p.f0
  if (!(w > 1e-6)) return 0
  return Math.max(0, Math.min(1, (along - p.f0) / w))
}

function angleGap(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d < 0) d += 2 * Math.PI
  return d > Math.PI ? 2 * Math.PI - d : d
}

/**
 * 場域座標 → 圖面位置。
 *
 * 有車頭朝向就拿來排除走向相反的那一條——上下行在圖上只差 3.5 公尺，位置分不出來，
 * 走向差 180 度卻一目了然。沒有朝向時退回純距離。
 */
export function locateByField(
  index: TrackGenIndex,
  xM: number,
  yM: number,
  headingRad?: number,
): Located | null {
  const cx = Math.floor(xM / index.cellM)
  const cy = Math.floor(yM / index.cellM)
  const candidates = index.grid.get(cellKey(cx, cy))
  if (!candidates?.length) return null

  let best: Located | null = null
  let bestScore = Infinity
  for (const i of candidates) {
    const p = index.pieces[i]!
    // 只在這一段自己那一截上比：一塊路口元件橫跨好幾段，整條一起量會每一段都同分
    const { along, distance, side } = projectAlongPath(p.real, xM, yM, { from: p.f0, to: p.f1 })
    /*
     * 走向不合的直接放到最後。差超過 90 度就是反方向那一條，不是「比較差的候選」。
     */
    const wrongWay =
      headingRad !== undefined && angleGap(headingRad, p.travelRad) > Math.PI / 2
    const score = distance + (wrongWay ? 1e6 : 0)
    if (score < bestScore) {
      bestScore = score
      best = {
        facilityId: p.facilityId,
        road: p.road,
        lane: p.lane,
        // 里程照這一段自己佔的那一截換算：路口的元件橫跨兩條腿，用整塊的比例會差很遠
        sM: p.s0 + (p.s1 - p.s0) * spanFrac(p, along),
        along,
        local: pointAlongPath(p.local, along),
        offsetM: side,
      }
    }
  }
  return best
}
