import type { CornerTrackGeometry, SwitchTrackGeometry, TaperTrackGeometry } from './trackShapes'
import { cornerArcCentrePx, cornerTrackEndsPx, switchTrackEndSegmentsPx } from './trackShapes'

export type Vec2 = { x: number; y: number }
/** 這一段是路上的軌道還是路口裡的連接道 */
export type LaneRole = 'road' | 'junction'

/**
 * 版面形狀的共用型別與幾何。
 *
 * 排版本身在 {@link ./trackGenGraphLayout} —— 那支吃的是路網<strong>圖</strong>。這裡
 * 只留三件所有人都要用的東西：形狀的型別、把一段路切成幾塊的規則、以及圓角與分岔
 * 的擺位求解。
 *
 * 舊的「脊線 + 橫向偏移」排版已經整支刪掉。它是走廊模型：一條主鏈當骨幹、其他線
 * 表示成相對它的橫向偏移。場域是路網不是走廊，於是環被切開、岔出去的線變尖刺、
 * 路口的兩條線互相穿透——每一項都補過，補到後來補丁比重寫還貴。
 */

export const LANE_W_M = 3.35


/**
 * 每個形狀都帶著它在<strong>真實</strong>路網裡的橫向偏移。
 *
 * 版面上的橫向偏移被放大過、側線還被吸到整數股，拿它回推真實座標會差很遠。
 * 參照場域範圍要的是真實座標，所以真實偏移必須另外帶著走。
 */
export type RealLateral = {
  /** 這個形狀屬於哪一條線，以及那條線多長——重疊時用來決定優先權 */
  lineKey: string
  lineLengthM: number
  /** 起點的真實橫向偏移（公尺，行進方向左側為正） */
  realLatFromM: number
  /** 終點的真實橫向偏移（公尺） */
  realLatToM: number
  /**
   * 這一段在圖面上的中心線（版面公尺，依里程由小到大）。
   *
   * 車輛投影要的就是這條線：真實座標先落在真實路徑上得到「走了幾成」，再照同樣
   * 的比例落在這條線上。少了它，圓角只能沿 refField 的長邊做線性內插——弧被拉成
   * 直線，實測車子在轉角處會跳 137 像素。
   */
  samples: Vec2[]
  /**
   * 這一段的真實中心線（公尺）。
   *
   * 圖模型沒有全域里程，真實座標只能由邊自己的取樣點內插出來，所以直接帶著走；
   * 舊的脊線模型留空，由 refPoints 加里程回推。
   */
  realPath?: Vec2[]
}

export type LayoutRect = RealLateral & {
  kind: 'rect'
  name: string
  role: LaneRole
  /** 中心點（版面公尺） */
  centre: Vec2
  /** 未旋轉前的尺寸：長沿行進方向、寬跨軌道 */
  lengthM: number
  widthM: number
  /** 螢幕座標下的旋轉角（度，順時針為正） */
  rotationDeg: number
  sFrom: number
  sTo: number
}

/**
 * 彎道：一段等寬的弧帶，整段一個物件。
 *
 * 外緣與內緣同心，所以整段等寬、沒有接縫。
 */
export type LayoutCorner = RealLateral & {
  kind: 'corner'
  name: string
  role: LaneRole
  geometry: CornerTrackGeometry
  /** 外接方框（版面公尺，左上原點、y 向下） */
  box: { xM: number; yM: number; wM: number; hM: number }
  /** 外緣半徑，畫的先後用它排序 */
  outerRadiusM: number
  sFrom: number
  sTo: number
}

/** 換股道：一段斜接軌道 */
export type LayoutTaper = RealLateral & {
  kind: 'taper'
  name: string
  role: LaneRole
  geometry: TaperTrackGeometry
  box: { xM: number; yM: number; wM: number; hM: number }
  sFrom: number
  sTo: number
}

/** 分岔：一進兩出，路口用它取代兩段互相穿透的斜接 */
export type LayoutSwitch = RealLateral & {
  kind: 'switch'
  name: string
  role: LaneRole
  geometry: SwitchTrackGeometry
  box: { xM: number; yM: number; wM: number; hM: number }
  sFrom: number
  sTo: number
}

export type LayoutShape = LayoutRect | LayoutCorner | LayoutTaper | LayoutSwitch

export type TrackGenLayout = {
  shapes: LayoutShape[]
  /** 全部形狀的外框（版面公尺） */
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number }
}

const DEG = Math.PI / 180

function rotate(v: Vec2, deg: number): Vec2 {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}


const QUARTERS = [0, 90, 180, 270] as const

/** 兩端點對兩端點，允許互換，回傳較小的總誤差 */
function pairError(a: Vec2, b: Vec2, p: Vec2, q: Vec2): number {
  const d = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y)
  return Math.min(d(a, p) + d(b, q), d(a, q) + d(b, p))
}

/**
 * 挑一個方位，讓弧帶兩端落在 p0／p1 上。
 *
 * 圓心固定在 centre（四種方位分別落在方框的四個角），所以方位一決定，外框位置
 * 也就決定了。四種都算一次兩端的誤差，取最小。
 */
export function fitCornerAt(
  centre: Vec2,
  outerRM: number,
  bandWM: number,
  p0: Vec2,
  p1: Vec2,
): { geometry: CornerTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  const S = Math.max(1e-3, outerRM)
  /*
   * 內弧半徑照<strong>比例</strong>縮，不是減掉固定公尺數。
   *
   * 外框之後會被非等比地放進 Area（橫向與縱向各自縮放）；等比例縮的內弧在縮放後
   * 兩端的帶寬各自等於該方向的帶寬，剛好接上相鄰的直線段。減固定值的話帶子會
   * 一頭粗一頭細。
   */
  const innerRatio = Math.max(0, Math.min(0.98, 1 - bandWM / S))
  let best: {
    geometry: CornerTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null
  for (const entryDeg of QUARTERS) {
    const geometry: CornerTrackGeometry = {
      arcXRatio: 1,
      arcYRatio: 1,
      innerXRatio: innerRatio,
      innerYRatio: innerRatio,
      outerBulge: 1,
      innerBulge: 1,
      entryDeg,
    }
    // 圓心在方框內的位置固定，外框左上角＝圓心座標減掉這個位移
    const off = cornerArcCentrePx(entryDeg, S, S)
    const box = { xM: centre.x - off.x, yM: centre.y - off.y, wM: S, hM: S }
    const ends = cornerTrackEndsPx(geometry, S, S)
    const a = { x: box.xM + ends.a.x, y: box.yM + ends.a.y }
    const b = { x: box.xM + ends.b.x, y: box.yM + ends.b.y }
    const err = pairError(a, b, p0, p1)
    if (!best || err < best.err) best = { geometry, box, err }
  }
  return { geometry: best!.geometry, box: best!.box }
}


/**
 * 解出分岔軌道的方位、外框與三個端面。
 *
 * 三個端面都是與軸對齊的線段，中心分別落在「進口」「直行出口」「岔出出口」上；
 * 帶寬等於 bandWM。與斜接一樣不自己推方位——四種都算一次、拿元件自己的端面函式驗證，
 * 取誤差最小的那一種。
 */
export function fitSwitchAt(
  stem: Vec2,
  main: Vec2,
  branch: Vec2,
  bandWM: number,
  alongDeg?: number,
): { geometry: SwitchTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } | null {
  const allowed =
    alongDeg === undefined
      ? QUARTERS
      : QUARTERS.filter((q) => (((q - alongDeg) % 180) + 180) % 180 === 0)
  const quarters = allowed.length ? allowed : QUARTERS
  let best: {
    geometry: SwitchTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null

  for (const entryDeg of quarters) {
    const R = (p: Vec2) => rotate(p, -entryDeg)
    const s = R(stem)
    const m = R(main)
    const b = R(branch)
    // 兩個出口都必須在進口的前方，不然這個方位擺不出來
    if (m.x - s.x <= 1e-6 || b.x - s.x <= 1e-6) continue
    const W = Math.max(m.x, b.x) - s.x
    const ys = [s.y, m.y, b.y]
    const top = Math.min(...ys) - bandWM / 2
    const H = Math.max(...ys) + bandWM / 2 - top
    const r = (y: number) => (y - top) / H
    const geometry: SwitchTrackGeometry = {
      aFrom: r(s.y - bandWM / 2),
      aTo: r(s.y + bandWM / 2),
      mFrom: r(m.y - bandWM / 2),
      mTo: r(m.y + bandWM / 2),
      bFrom: r(b.y - bandWM / 2),
      bTo: r(b.y + bandWM / 2),
      entryDeg,
    }
    const wM = entryDeg % 180 === 0 ? W : H
    const hM = entryDeg % 180 === 0 ? H : W
    const segs = switchTrackEndSegmentsPx(geometry, wM, hM)
    const mid = (q: [Vec2, Vec2]) => ({ x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 })
    // 平移量取三個端面各自需要的位移的平均，殘差就是彼此的差
    const want = [stem, main, branch]
    const got = [mid(segs.a), mid(segs.m), mid(segs.b)]
    const ex = want.reduce((t, p, i) => t + (p.x - got[i]!.x), 0) / 3
    const ey = want.reduce((t, p, i) => t + (p.y - got[i]!.y), 0) / 3
    const err = Math.max(
      ...want.map((p, i) => Math.hypot(p.x - got[i]!.x - ex, p.y - got[i]!.y - ey)),
    )
    if (!best || err < best.err) {
      best = { geometry, box: { xM: ex, yM: ey, wM, hM }, err }
    }
  }
  if (!best || best.err > Math.max(2, bandWM * 0.25)) return null
  return { geometry: best.geometry, box: best.box }
}

/**
 * 一段路切成幾塊。
 *
 * 對話框的估算與實際排版<strong>吃同一支</strong>：先前估算用 `round(總長/一塊)`，
 * 排版卻是「整數塊 + 尾巴，尾巴太短就併進前一塊」。214 公尺配一塊 80 公尺時估算
 * 說 3 塊、實際只生 2 塊，數字對不上。
 */
export function blocksInSpan(spanM: number, perBlockM: number, minRunM: number): number {
  const per = Math.max(1e-6, perBlockM)
  if (spanM <= 0) return 0
  const full = Math.floor(spanM / per)
  const rest = spanM - full * per
  if (full > 0 && rest < minRunM) return full
  return full + (rest > 0 ? 1 : 0)
}
