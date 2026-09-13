import type {
  CornerTrackGeometry,
  CrossTrackGeometry,
  SwitchTrackGeometry,
  TaperTrackGeometry,
} from './trackShapes'
import {
  cornerArcCentrePx,
  cornerTrackEndsPx,
  switchTrackEndSegmentsPx,
  taperTrackEndsPx,
} from './trackShapes'
import { DEFAULT_ORDINARY_TRACK_FILL_COLOR } from './trackFacility'

export type Vec2 = { x: number; y: number }
/** 這一段是路上的軌道還是路口裡的連接道 */
export type LaneRole = 'road' | 'junction'

/**
 * 版面形狀的共用型別與幾何。
 */

export const LANE_W_M = 3.35

/**
 * 四種元件在圖上的底色。
 * 一般軌道（rect）預設與 DEFAULT_ORDINARY_TRACK_FILL_COLOR 一致。
 * stroke 用深色，預覽與生成後框線一致。
 */
export const TRACK_GEN_KIND_COLOR = {
  rect: { fill: DEFAULT_ORDINARY_TRACK_FILL_COLOR, stroke: '#05070a' },
  corner: { fill: '#2f4f4a', stroke: '#05070a' },
  taper: { fill: '#33435c', stroke: '#05070a' },
  switch: { fill: '#463c5e', stroke: '#05070a' },
  cross: { fill: '#5c3a3a', stroke: '#05070a' },
} as const



/**
 * 每個形狀都帶著它在<strong>真實</strong>路網裡的橫向偏移。
 *
 * 版面上的橫向偏移被放大過、側線還被吸到整數股，拿它回推真實座標會差很遠。
 * 場域範圍要的是真實座標，所以真實偏移必須另外帶著走。
 */
export type RealLateral = {
  /** 這個形狀屬於哪一條線，以及那條線多長——重疊時用來決定優先權 */
  lineKey: string
  lineLengthM: number
  /**
   * 這一段的橫向比例尺：真實世界橫移一公尺，圖上橫移多少（版面單位）。
   */
  latScalePerM?: number
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
  /**
   * 這一塊<strong>代表路網的哪一段</strong>。
   */
  spans?: TrackSpan[]
}

/** 一塊軌道代表的路網區間 */
export type TrackSpan = {
  roadId: string
  laneId: number
  /**
   * 沿該 road 參考線的里程（公尺），<strong>照路徑的順序</strong>記，不是由小到大。
   *
   * 路口的元件會把其中一條腿反過來接（畫面上要從這頭連到那頭），那條腿的里程就是遞減的。
   * 硬排成由小到大，里程換算會整個顛倒——實測車輛在路口的里程差到 117 公尺。
   */
  sFromM: number
  sToM: number
  /**
   * 這一段的<strong>行車方向</strong>（弳度，真實座標）。
   *
   * 定位時拿它跟車頭朝向比，就能把走向相反的那條車道篩掉——上下行在場上只差 3.5 公尺，
   * 位置分不出來，走向差 180 度卻一目了然。
   */
  headingRad: number
  /**
   * 這一段對應到<strong>這塊軌道路徑的哪一截</strong>（0–1）。
   *
   * 直軌與斜接整條就是一段，所以是 0–1。路口的元件橫跨兩條腿：前半屬於一條、後半屬於
   * 另一條，里程要照各自那一截換算。少了這個，車輛在路口的里程會被整塊的比例拉開——
   * 實測差到 117 公尺。
   */
  pathFrom: number
  pathTo: number
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

/** 交叉：兩條軌道在這裡交會，四個口互相都通 */
export type LayoutCross = RealLateral & {
  kind: 'cross'
  name: string
  role: LaneRole
  geometry: CrossTrackGeometry
  box: { xM: number; yM: number; wM: number; hM: number }
  sFrom: number
  sTo: number
}

export type LayoutShape =
  | LayoutRect
  | LayoutCorner
  | LayoutTaper
  | LayoutSwitch
  | LayoutCross

export type TrackGenLayout = {
  shapes: LayoutShape[]
  /** 橫向比例尺：真實世界橫移一公尺，圖上橫移多少（版面單位） */
  latScalePerM: number
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
/**
 * 轉角的弧帶：兩隻腳<strong>各給一個半徑</strong>。
 *
 * 正圓要求兩隻腳一樣長。實際上不一定：節點在沿線方向上有自己的偏移，兩條邊讓出來的
 * 長度因此會差一點（實測 19.3 對 22.4 像素）。硬畫成正圓就得取平均，兩個端面各差一半
 * ——那正是圖上看到的錯位。
 */
export function fitCornerAt(
  centre: Vec2,
  outerAM: number,
  outerBM: number,
  bandWM: number,
  p0: Vec2,
  p1: Vec2,
): { geometry: CornerTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  const A = Math.max(1e-3, outerAM)
  const B = Math.max(1e-3, outerBM)
  let best: {
    geometry: CornerTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null
  for (const entryDeg of QUARTERS) {
    // 兩隻腳誰對到外框的寬、誰對到高，由方位決定；兩種都試，取接得最準的
    for (const [wM, hM] of [
      [A, B],
      [B, A],
    ]) {
      /*
       * 內弧半徑照<strong>比例</strong>縮，不是減掉固定公尺數。
       */
      const swap = (Math.round((((entryDeg % 360) + 360) % 360) / 90) & 3) % 2 === 1
      const w = Math.max(1e-3, swap ? hM! : wM!)
      const h = Math.max(1e-3, swap ? wM! : hM!)
      const geometry: CornerTrackGeometry = {
        arcXRatio: 1,
        arcYRatio: 1,
        innerXRatio: Math.max(0, Math.min(0.98, 1 - bandWM / w)),
        innerYRatio: Math.max(0, Math.min(0.98, 1 - bandWM / h)),
        outerBulge: 1,
        innerBulge: 1,
        entryDeg,
      }
      // 圓心在方框內的位置固定，外框左上角＝圓心座標減掉這個位移
      const off = cornerArcCentrePx(entryDeg, wM!, hM!)
      const box = { xM: centre.x - off.x, yM: centre.y - off.y, wM: wM!, hM: hM! }
      const ends = cornerTrackEndsPx(geometry, wM!, hM!)
      const a = { x: box.xM + ends.a.x, y: box.yM + ends.a.y }
      const b = { x: box.xM + ends.b.x, y: box.yM + ends.b.y }
      const err = pairError(a, b, p0, p1)
      if (!best || err < best.err) best = { geometry, box, err }
    }
  }
  return { geometry: best!.geometry, box: best!.box }
}


/**
 * 解出方位、外框與錯位，讓斜帶兩端落在 p0／p1 上、且帶寬等於 bandWM。
 */
export function fitTaperAt(
  p0: Vec2,
  p1: Vec2,
  bandWM: number,
  alongDeg: number,
): { geometry: TaperTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  /*
   * 端面必須<strong>垂直於軌道方向</strong>，不是由斜線自己的走向決定。
   */
  const allowed = QUARTERS.filter((q) => (((q - alongDeg) % 180) + 180) % 180 === 0)
  const quarters = allowed.length ? allowed : QUARTERS
  let best: {
    geometry: TaperTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null

  for (const entryDeg of quarters) {
    for (const [ta, tb] of [
      [p0, p1],
      [p1, p0],
    ] as Array<[Vec2, Vec2]>) {
      // 把目標向量轉回形狀自己的座標系
      const v = rotate({ x: tb.x - ta.x, y: tb.y - ta.y }, -entryDeg)
      if (v.x <= 1e-6) continue
      const dx = v.x
      const dy = Math.abs(v.y)
      /*
       * 端面高度就是<strong>帶寬本身</strong>，不是換算成垂直於斜向的寬度。
       */
      const faceH = bandWM
      const W = dx
      const H = dy + faceH
      const r = Math.max(0, Math.min(1, faceH / H))
      /*
       * 往上走與往下走都要能表示。
       */
      const down = v.y >= 0
      const geometry: TaperTrackGeometry = down
        ? { aFrom: 0, aTo: r, bFrom: 1 - r, bTo: 1, entryDeg }
        : { aFrom: 1 - r, aTo: 1, bFrom: 0, bTo: r, entryDeg }
      // 轉 90 度時形狀的寬高在世界座標裡互換
      const wM = entryDeg % 180 === 0 ? W : H
      const hM = entryDeg % 180 === 0 ? H : W
      const ends = taperTrackEndsPx(geometry, wM, hM)
      // 平移量取兩端各自需要的位移的平均，殘差就是兩者的差
      const ex = ((ta.x - ends.a.x) + (tb.x - ends.b.x)) / 2
      const ey = ((ta.y - ends.a.y) + (tb.y - ends.b.y)) / 2
      const err = Math.hypot(ta.x - ends.a.x - ex, ta.y - ends.a.y - ey) * 2
      if (!best || err < best.err) {
        best = { geometry, box: { xM: ex, yM: ey, wM, hM }, err }
      }
    }
  }
  if (best) return { geometry: best.geometry, box: best.box }
  // 兩點重合之類的退化情形：給一個等寬的方塊，至少畫得出來
  return {
    geometry: { aFrom: 0, aTo: 1, bFrom: 0, bTo: 1, entryDeg: 0 },
    box: {
      xM: Math.min(p0.x, p1.x) - bandWM / 2,
      yM: Math.min(p0.y, p1.y) - bandWM / 2,
      wM: Math.max(bandWM, Math.abs(p1.x - p0.x)),
      hM: Math.max(bandWM, Math.abs(p1.y - p0.y)),
    },
  }
}

/**
 * 解出分岔軌道的方位、外框與三個端面。
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
      /*
       * 兩條腿<strong>各伸各的</strong>：出口離進口多遠，就照那個比例擺。
       */
      mAt: (m.x - s.x) / W,
      bAt: (b.x - s.x) / W,
      entryDeg,
    }
    const wM = entryDeg % 180 === 0 ? W : H
    const hM = entryDeg % 180 === 0 ? H : W
    const segs = switchTrackEndSegmentsPx(geometry, wM, hM)
    const mid = (q: [Vec2, Vec2]) => ({ x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 })
    // 三個端面各自都放對了，所以三個位移相同；取平均只是把它算出來，殘差用來驗證
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
