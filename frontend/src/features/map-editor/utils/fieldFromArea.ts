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
 */

export type FieldPoint = {
  xM: number
  yM: number
  /** 'track' 是從生成的軌道反推的；'area' 是照容器網域換算的 */
  source: 'track' | 'area'
  /** 從軌道反推時，離那一段中心線多遠（公尺，左正右負） */
  offsetM?: number
  /**
   * 離那一段<strong>畫出來的</strong>中心線多遠（區域像素）。
   *
   * 挑「由誰解釋這個點」時要比這個，不能比公尺：各段的比例尺差到二十四倍，
   * 同樣的像素距離換算出來的公尺數完全不同，跨塊比公尺等於比不同單位。
   */
  sidePx?: number
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
  let sidePx: number
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
    // 圓角的外框近似正方形，兩軸比例尺相同，取平均邊長換回像素
    sidePx = Math.abs(hit.side) * ((size.w + size.h) / 2)
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
    // delta 是比例座標裡的偏移，乘回那一軸的邊長就是像素
    sidePx = Math.abs(delta) * (alongU ? size.h : size.w)
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
    sidePx,
    trackId: f.id,
  }
}

/**
 * 這個容器裡有沒有生成出來的軌道。
 *
 * 有的話，<strong>容器自己的網域不是場域座標</strong>：網域是 0 到寬、0 到高的格線，
 * 生成的軌道用的是 .xodr 的座標（T3 那份在 −100 到 −900 之間）。兩者混在同一組數字裡，
 * 會得到一個看起來像座標、實際上差了幾百公尺的答案——實測一塊斜接的場域範圍因此
 * 橫跨整張圖（x −884～119、y −194～447）。所以呼叫端拿到 source 'area' 的答案時，
 * 要先問這一句再決定能不能用。
 */
export function areaHasTrackGenTracks(area: MapAreaObject): boolean {
  return area.facilities.some(
    (f) => f.type === 'Track' && getTrackGenPaths(f.parameters) !== null,
  )
}

/**
 * 離軌道多遠<strong>還算得出</strong>真實座標（公尺）。
 *
 * 與車輛定位同一個上限：再遠就沒有依據說它屬於哪條路，換算出來的數字只是把一條
 * 中心線無限外推，不是現場的位置。
 */
const MAX_OFF_TRACK_M = 25

/**
 * 這個點離一塊軌道<strong>畫出來的框</strong>多遠（區域像素）；在框內就是 0。
 *
 * 挑「由誰解釋這個點」時要比這個，不能比公尺——見 fieldMetersAtAreaLocal。
 */
function footprintDistancePx(
  f: FacilityObject,
  area: MapAreaObject,
  xPx: number,
  yPx: number,
): number {
  const pos = resolveFacilityAreaPosition(f, area.domain, area.layout)
  const size = resolveFacilityAreaSize(f, area.domain, area.layout)
  const dx = Math.max(pos.x - xPx, 0, xPx - (pos.x + size.w))
  const dy = Math.max(pos.y - yPx, 0, yPx - (pos.y + size.h))
  return Math.hypot(dx, dy)
}

/**
 * 還算「就在旁邊」的圖面距離（區域像素）。
 *
 * 一塊軌道畫出來大約 50–170 像素寬，取 40 大致是「貼著或差一點點」。再遠就不是鄰居，
 * 不該由它來解釋這個點。
 */
const NEAR_FOOTPRINT_PX = 40

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
  /*
   * 指定了由哪一塊解釋，那一塊算不出來時<strong>不要偷偷換一塊</strong>。
   *
   * 原本算不出來就掉回全域最佳解，於是呼叫端問「請用 U19 解釋這個點」，拿回來的卻是
   * D19 算的數字，而且看不出來被換過。實測 T3上行 那個停靠點：它畫在 U19 框內，但
   * U19 缺 trackGenLatPerBox（橫向比例尺）算不出來，答案就由 87 像素外的 D19 給了
   * ——座標落在隔壁那條線再往旁邊 16 公尺，而兩條線只差 3.5 公尺。
   *
   * 改成回容器網域那個答案：呼叫端本來就會檢查 source 是不是 'area'，在有生成軌道的
   * 圖上看到 'area' 就不寫。答錯不如不答。
   */
  if (options?.preferTrackId) {
    const f = area.facilities.find((x) => x.id === options.preferTrackId)
    const got = f ? fieldFromTrack(f, area, xPx, yPx) : null
    if (got) return got
    const m = areaLocalPxToMeter(xPx, yPx, area.domain, area.layout)
    return { xM: m.x, yM: m.y, source: 'area' }
  }
  /*
   * 挑<strong>離中心線最近</strong>的那一塊。
   *
   * 試過再加一項「跑出框外多遠」把遠處的候選推開，量出來一個數字都沒變——贏的本來
   * 就是那一塊，錯不在挑塊。所以維持只比偏移量。
   */
  /*
   * 挑<strong>圖面上就在旁邊</strong>的那一塊，不是「偏移公尺數最小」的那一塊。
   *
   * 示意圖各段的比例尺差很多：正線那一段 57 像素畫 9.7 公尺（0.17 公尺/像素），
   * T3 支線 53 像素畫 66 公尺（1.25 公尺/像素），差七倍。照公尺比的話，一塊在畫面上
   * 隔了兩千多像素、但被壓得很扁的正線方塊，算出來的偏移量反而比正下方那塊 T3 支線
   * 還小，就把點搶走了——實測新放在 T3 轉角的一塊斜接，四個角有兩個被判給正線，
   * 場域座標因此差了 180 公尺。
   *
   * 拖曳的人看到的是圖面上的相鄰關係，那也正是唯一可靠的依據：貼著誰，就由誰解釋。
   * 公尺只留著在同樣貼著的幾塊之間分高下（上下行疊在一起時就靠它）。
   */
  /*
   * 平手（框重疊）時比離中心線多遠。
   *
   * 試過改比像素而不是公尺——分岔那兩塊沒有變好：實測 U04/T03 的中心線上有一點，
   * 離 D05 畫出來的線只有 2.0 像素，離自己那條 4.9 像素。示意圖在那裡把兩條線畫得
   * 重疊，<strong>單看圖面，反推本來就無解</strong>，換哪一種尺都一樣。
   *
   * 要正確反推只能由呼叫端指定是哪一塊（preferTrackId）。所以這裡維持原樣，不做
   * 沒有改善的變動。
   */
  let best: FieldPoint | null = null
  let bestPx = Infinity
  let bestOff = Infinity
  /** 全都構不上時的退路：圖面上離得最近的那一塊 */
  let fallback: FieldPoint | null = null
  let fallbackPx = Infinity
  for (const f of area.facilities) {
    if (f.type !== 'Track') continue
    const got = fieldFromTrack(f, area, xPx, yPx)
    if (!got) continue
    const px = footprintDistancePx(f, area, xPx, yPx)
    if (px < fallbackPx) {
      fallback = got
      fallbackPx = px
    }
    if (px > NEAR_FOOTPRINT_PX) continue
    if (Math.abs(got.offsetM ?? 0) > MAX_OFF_TRACK_M) continue
    const off = Math.abs(got.offsetM ?? Infinity)
    // 先比圖面距離；一樣近（例如上下行疊著）才比偏移量
    if (px < bestPx - 0.5 || (Math.abs(px - bestPx) <= 0.5 && off < bestOff)) {
      best = got
      bestPx = px
      bestOff = off
    }
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
