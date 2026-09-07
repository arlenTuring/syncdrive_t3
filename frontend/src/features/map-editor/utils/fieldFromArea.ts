import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { areaLocalPxToMeter } from './areaCoords'
import {
  resolveFacilityAreaPosition,
  resolveFacilityAreaSize,
} from './facilityAreaCoords'
import {
  getTrackGenSpans,
} from './trackGenPaths'
import {
  getTrackGenLatMode,
  getTrackGenLatPerBox,
  getTrackGenPaths,
  pointAlongPath,
  projectAlongPath,
  tangentAlongPath,
  type PathXY,
} from './trackGenPaths'

/**
 * 圖上的位置 → 現場的真實座標。
 *
 * 這是車輛定位的<strong>反方向</strong>：定位是「真實座標畫在圖上哪裡」，這裡是
 * 「圖上這一點在現場是哪裡」。放停靠點、途經點、設施時要的就是這個——使用者在圖上
 * 放好，現場座標算出來，不必手填。
 *
 * <h3>兩條路</h3>
 * <ul>
 *   <li><strong>高精地圖生成的軌道</strong>：每一塊身上都有真實路徑與圖面路徑，
 *       反推得出來，而且連「離軌道多遠」都算得出來——放在軌道旁邊的東西也有座標。</li>
 *   <li><strong>使用者自己拉的軌道</strong>：沒有那份資料，沒有任何依據可以推真實
 *       座標。只能照 Area 自己的網域換算；容器的網域與像素一樣大時（生成出來的
 *       Area 就是這樣），那就是 1:1，座標系與方向都跟容器一致。</li>
 * </ul>
 */

export type FieldPoint = {
  xM: number
  yM: number
  /** 'track' 是從生成的軌道反推的；'area' 是照容器網域換算的 */
  source: 'track' | 'area'
  /** 從軌道反推時，離那一段中心線多遠（公尺，左正右負） */
  offsetM?: number
  trackId?: string
}

function readRotationDeg(f: FacilityObject): number {
  const r = (f as { rotation?: number }).rotation
  return typeof r === 'number' && Number.isFinite(r) ? r : 0
}

/**
 * 沿折線找「某一軸等於某個值」的那一點，回傳弧長比例。
 *
 * 值落在這條線的範圍之外就回 null，<strong>不夾到端點</strong>。夾的話，圖上另一頭
 * 一塊八竿子打不著的軌道也會宣稱「這一點在我的端點上、只偏了幾公分」，然後被選中
 * ——實測往返誤差中位數 107 公尺就是這樣來的。沿線的範圍是硬條件，橫向才可以自由。
 */
function alongAtAxisValue(path: PathXY, axis: 0 | 1, value: number): number | null {
  let total = 0
  const seg: number[] = [0]
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
    seg.push(total)
  }
  if (!(total > 0)) return null
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]![axis]
    const b = path[i]![axis]
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (value < lo - 1e-9 || value > hi + 1e-9) continue
    const u = Math.abs(b - a) < 1e-12 ? 0 : (value - a) / (b - a)
    return (seg[i - 1]! + (seg[i]! - seg[i - 1]!) * u) / total
  }
  return null
}

/** 一個生成的軌道元件能不能解釋這一點；不能就回 null */
function fieldFromTrack(
  f: FacilityObject,
  area: MapAreaObject,
  xPx: number,
  yPx: number,
): FieldPoint | null {
  const paths = getTrackGenPaths(f.parameters)
  const latPerBox = getTrackGenLatPerBox(f.parameters)
  if (!paths || !latPerBox) return null

  const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  if (!(size.w > 0) || !(size.h > 0)) return null

  // 先把旋轉轉回去，才落在元件自己的未旋轉外框裡
  const rot = readRotationDeg(f)
  let lx = xPx
  let ly = yPx
  if (Math.abs(rot) > 0.001) {
    const cx = pos.x + size.w / 2
    const cy = pos.y + size.h / 2
    const rad = (-rot * Math.PI) / 180
    const dx = xPx - cx
    const dy = yPx - cy
    lx = cx + dx * Math.cos(rad) - dy * Math.sin(rad)
    ly = cy + dx * Math.sin(rad) + dy * Math.cos(rad)
  }
  // 圖面路徑的 v 是「外框上緣為 0」，區域座標的 y 由下往上，所以翻一次
  const uv = { x: (lx - pos.x) / size.w, y: 1 - (ly - pos.y) / size.h }

  let along: number
  let sideM: number
  if (getTrackGenLatMode(f.parameters) === 'arc') {
    /*
     * 圓角：並排的軌道是同心弧，偏移量沿法線。外框近似正方形，所以兩軸的比例尺
     * 相同，直接在比例座標裡投影再除以比例尺就好。
     */
    const hit = projectAlongPath(paths.local, uv.x, uv.y)
    // 投影落在弧的端點上，表示這一點在這一塊的沿線範圍之外，不該由它解釋
    if (hit.along <= 1e-6 || hit.along >= 1 - 1e-6) return null
    along = hit.along
    const scale = (latPerBox[0] + latPerBox[1]) / 2
    // projectAlongPath 的 side 是圖面座標的左手邊，真實世界的左手邊相反
    sideM = scale > 1e-12 ? -hit.side / scale : 0
  } else {
    /*
     * 其餘：帶子沿外框的一軸走，偏移量沿另一軸。沿線的位置由「走的那一軸」決定，
     * 偏移量就是另一軸的差——不必投影，是解析解。
     */
    const a = paths.local[0]!
    const b = paths.local[paths.local.length - 1]!
    const alongU = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
    const t = alongAtAxisValue(paths.local, alongU ? 0 : 1, alongU ? uv.x : uv.y)
    if (t === null) return null
    along = t
    const on = pointAlongPath(paths.local, along)
    const d = tangentAlongPath(paths.local, along)
    const delta = alongU ? uv.y - on.y : uv.x - on.x
    const sign = alongU ? Math.sign(-d.x || 1) : Math.sign(d.y || 1)
    const per = alongU ? latPerBox[1] : latPerBox[0]
    sideM = per > 1e-12 ? delta / (sign * per) : 0
  }

  /*
   * 路口的元件（分岔、交叉）一塊代表<strong>好幾段路</strong>，真實路徑是把幾條腿接
   * 起來的，腿與腿之間隔著連接道——那一段在真實世界是跳過去的，不是一條路。落在
   * 跳空處的點不屬於這一塊，硬換算會得到一個離題幾十公尺的座標（實測往返誤差最大
   * 63.7 公尺）。不屬於就說不屬於，讓別的塊去解釋。
   */
  const spans = getTrackGenSpans(f.parameters)
  if (spans.length > 1) {
    let best: number | null = null
    let bestGap = Infinity
    for (const sp of spans) {
      const lo = Math.min(sp.f0, sp.f1)
      const hi = Math.max(sp.f0, sp.f1)
      const clamped = Math.max(lo, Math.min(hi, along))
      const gap = Math.abs(clamped - along)
      if (gap < bestGap) {
        bestGap = gap
        best = clamped
      }
    }
    if (best !== null) along = best
  }

  const base = pointAlongPath(paths.real, along)
  const d = tangentAlongPath(paths.real, along)
  // 真實世界 y 向上：方向 (dx, dy) 的左手邊是 (−dy, dx)
  return {
    xM: base.x - d.y * sideM,
    yM: base.y + d.x * sideM,
    source: 'track',
    offsetM: sideM,
    trackId: f.id,
  }
}

/**
 * 離軌道多遠<strong>還算得出</strong>真實座標（公尺）。
 *
 * 與車輛定位同一個上限：再遠就沒有依據說它屬於哪條路，換算出來的數字只是把一條
 * 中心線無限外推，不是現場的位置。
 */
const MAX_OFF_TRACK_M = 25

/**
 * 區域座標（Area 內、左下原點、y 向上）→ 現場真實座標。
 *
 * 先問生成的軌道；都構不上時照容器的網域換算。
 */
export function fieldMetersAtAreaLocal(
  area: MapAreaObject,
  xPx: number,
  yPx: number,
  options?: {
    /**
     * 指定由哪一塊來解釋。
     *
     * 離開軌道之後，同一個圖上的點可能落在兩塊附近——示意圖把不同的地方畫得很接近，
     * 反推本來就不唯一。呼叫端知道是接在哪一塊上時就指定，答案才不會在兩塊之間跳。
     */
    preferTrackId?: string
  },
): FieldPoint {
  if (options?.preferTrackId) {
    const f = area.facilities.find((x) => x.id === options.preferTrackId)
    const got = f ? fieldFromTrack(f, area, xPx, yPx) : null
    if (got) return got
  }
  let best: FieldPoint | null = null
  /** 全都超出上限時的退路：離得最近的那一塊 */
  let fallback: FieldPoint | null = null
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    const got = fieldFromTrack(f, area, xPx, yPx)
    if (!got) continue
    const off = Math.abs(got.offsetM ?? 0)
    if (!fallback || off < Math.abs(fallback.offsetM ?? Infinity)) fallback = got
    if (off > MAX_OFF_TRACK_M) continue
    if (!best || off < Math.abs(best.offsetM ?? Infinity)) best = got
  }
  if (best) return best
  /*
   * 這個容器裡有生成的軌道時，<strong>不能退回容器的網域</strong>。
   *
   * 網域是容器自己的格線（0 到寬、0 到高），生成的軌道用的卻是 .xodr 的場域座標
   * （T3 那份在 −100 到 −900 之間）。兩者是不同的座標系，混用會回一個看起來像數字、
   * 實際上差了幾百公尺的答案。所以退而求其次：拿最近的那一塊硬算，離多遠就是多遠。
   */
  if (fallback) return fallback
  const m = areaLocalPxToMeter(xPx, yPx, area.domain, area.layout)
  return { xM: m.x, yM: m.y, source: 'area' }
}
