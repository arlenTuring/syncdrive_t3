import {
  isAlongX,
  placePoint,
  placeSpine,
  type TrackGenBlockSize,
  type TrackGenSettings,
} from './trackGenFacility'
import type { LaneRole, TrackGenResult, Vec2 } from './trackGenerator'
import {
  cornerArcCentrePx,
  cornerTrackEndsPx,
  switchTrackEndSegmentsPx,
  taperTrackEndsPx,
  type CornerTrackGeometry,
  type SwitchTrackGeometry,
  type TaperTrackGeometry,
} from './trackShapes'

/**
 * 生成結果 → 版面形狀。
 *
 * <h3>只用三種軌道元件</h3>
 * 整張圖只由這三種拼出來，沒有第四種東西：
 *
 *   一般軌道   矩形，畫直線段
 *   圓角軌道   四分之一等寬弧帶，畫轉角
 *   斜接軌道   平行四邊形，畫換股道
 *
 * <h3>演算法</h3>
 * 每一條車道都走同一條路，主線、側線、渡線不分特例：
 *
 * <ol>
 *   <li>把車道的橫向偏移吸到<strong>整數股道</strong>（buildLaneLevels）。真實的側線可以
 *       岔到幾十公尺外，簡圖要表達的是「在第幾股」而不是距離。</li>
 *   <li>依股道把車道切成一段一段——股道不變的一段就是一個區段。</li>
 *   <li>每個區段再依<strong>脊線</strong>切開，各自落在哪一段脊線上就畫成哪一種：
 *     <ul>
 *       <li>直線脊線段 → 一般軌道（主線再依「每塊目標長度」細分成 D01／U01…）</li>
 *       <li>彎道脊線段 → 圓角軌道，整段一個</li>
 *     </ul>
 *   </li>
 *   <li>相鄰兩個區段的股道不同 → 中間放一段斜接軌道，兩側的一般軌道讓出位置。</li>
 * </ol>
 *
 * <h3>兩條由元件本身決定的限制</h3>
 * 圓角軌道是<strong>四分之一</strong>，畫不出半段弧，所以一條線只要走進某段彎道就佔滿
 * 那整段；覆蓋不到兩成的視為沒有經過（否則一公尺的擦邊也會長出一個完整轉角）。
 * 斜接軌道是<strong>一段直的</strong>平行四邊形，所以只放在直線脊線段上；換股道發生在
 * 彎道上時就不畫那一段斜接，兩側的軌道直接相接。
 *
 * <h3>方位不用推的，用試的</h3>
 * 圓角與斜接軌道的形狀由元件自己的 path 函式決定，方位只有 90 度的倍數四種。
 * 排版<strong>不自己推</strong>該轉幾度——推錯過一次，整個轉角平移了一個外框的距離，
 * 而且畫面上看起來只是「位置怪怪的」，很難聯想到是角度慣例不一致。現在四種都試，
 * 挑兩端最貼合目標點的那一種，排版與繪製就不可能各說各話。
 *
 * <h3>與「套用到地圖」共用</h3>
 * 預覽與套用原本各自算一次位置，兩邊算法一有差異就對不起來——實際發生過：套用出來
 * 的軌道方向是反的、ㄩ 形也散掉了。兩邊都吃這一支的輸出，對不起來在結構上就不可能。
 *
 * 單位是<strong>版面公尺</strong>：沿線是真實公尺，橫向乘上放大倍率。上下行只差
 * 3.5 公尺，不放大會黏成一條線。真實座標另外由 refPoints 換算，不混在這裡。
 */

export const LANE_W_M = 3.35

/**
 * 斜接軌道的斜率 1:N。
 *
 * 不做成參數：使用者要調的是軌道寬與切幾刀，斜率是為了讓換股道看起來像鐵道示意圖
 * 而不是折斷，一個定值就夠。真實過渡長度不能照抄——橫向的比例尺比沿線大好幾倍，
 * 真實 1:30 的渡線畫出來會變成 1:3。
 */
const TAPER_SLOPE_N = 3

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

/** 形狀四角，用來算整體外框 */
function rectCorners(r: LayoutRect): Vec2[] {
  const hw = r.lengthM / 2
  const hh = r.widthM / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const q = rotate(p, r.rotationDeg)
    return { x: r.centre.x + q.x, y: r.centre.y + q.y }
  })
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
 * 解出方位、外框與錯位，讓斜帶兩端落在 p0／p1 上、且帶寬等於 bandWM。
 *
 * <h3>直接解，不要近似</h3>
 * 斜帶的兩個端面是垂直線段，高 f；帶的方向是 (dx, dy)。垂直於帶的寬度是
 * f·dx/√(dx²+dy²)，令它等於帶寬就解得 f。外框因此是 dx × (dy + f)，錯位比例是
 * dy/(dy+f)。先前拿外接方框再回推比例，帶寬會差將近一倍。
 *
 * 四種方位 × 兩種端點配對共八種擺法，只有一種能讓形狀在自己的座標系裡是
 * 「往右下走」；八種都算一次殘差取最小，就不必自己推該轉幾度。
 */
function fitTaper(
  p0: Vec2,
  p1: Vec2,
  bandWM: number,
  alongDeg: number,
): { geometry: TaperTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  /*
   * 端面必須<strong>垂直於軌道方向</strong>，不是由斜線自己的走向決定。
   *
   * 斜接軌道兩端接的是沿著脊線走的軌道，那些軌道的端面垂直於行進方向；端面方向
   * 一旦跟著斜線走，就會變成與軌道平行，怎麼接都對不上對手的邊——實測八段生成的
   * 斜接軌道裡有兩段是這樣，L2X-39 的端面是水平的、鄰居的端面卻是垂直的。
   *
   * 形狀的 a→b 軸就是 entryDeg，端面垂直於它，所以 entryDeg 要與軌道方向同軸。
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
       *
       * 軌道是端對端相接的：斜接軌道的端面必須與相鄰那一塊的端面一樣高，才接得
       * 平。先前把端面撐成 bandW·len/dx（讓垂直於斜向的寬度等於帶寬），端面就比
       * 鄰居高，接縫處看起來像折了一下。斜的那一段因此比直線段略窄，鐵道示意圖
       * 本來就是這樣畫的。
       */
      const faceH = bandWM
      const W = dx
      const H = dy + faceH
      const r = Math.max(0, Math.min(1, faceH / H))
      /*
       * 往上走與往下走都要能表示。
       *
       * 先前只接受往下（v.y ≥ 0），往上的那些一個候選都不剩，掉進退化的矩形——
       * 端面長度就變成整個外框高（實測 39.3，帶寬只有 30.2）。往上時把兩個端面
       * 上下對調即可，形狀一樣、只是鏡射。
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
 * 用折線逼近一條線的橫向剖面。
 *
 * <h3>為什麼不是吸到整數股道</h3>
 * 先前把橫向偏移吸到整數股，一段長長的漸變就只會變成「一次換股」——實際上那是一條
 * 平緩的 S 形，應該由<strong>連續好幾段斜接軌道</strong>接起來才像原圖。吸到整數股還會
 * 讓真實幾何整個消失：分隔島的寬度、兩線靠攏又拉開，全部被抹平成同一股。
 *
 * 改成 Douglas–Peucker：在（里程, 橫向偏移）平面上把剖面簡化成折線，容差就是可以
 * 忽略的橫向誤差。折線的每一段要嘛幾乎水平（→ 一般軌道），要嘛有斜率（→ 斜接軌道），
 * 段數由曲線自己的形狀決定，不是由我訂幾股。
 */
function simplifyProfile(
  profile: Array<[number, number]>,
  toleranceM: number,
): Array<[number, number]> {
  if (profile.length < 3) return [...profile]
  const keep = new Array<boolean>(profile.length).fill(false)
  keep[0] = true
  keep[profile.length - 1] = true

  const stack: Array<[number, number]> = [[0, profile.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    if (hi - lo < 2) continue
    const [s0, l0] = profile[lo]!
    const [s1, l1] = profile[hi]!
    const ds = s1 - s0
    let worst = -1
    let worstD = toleranceM
    for (let i = lo + 1; i < hi; i += 1) {
      const [s, l] = profile[i]!
      // 橫向誤差就好，不需要真正的垂直距離：里程軸與橫向軸的意義不同
      const expect = Math.abs(ds) < 1e-9 ? l0 : l0 + ((l1 - l0) * (s - s0)) / ds
      const d = Math.abs(l - expect)
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst < 0) continue
    keep[worst] = true
    stack.push([lo, worst], [worst, hi])
  }
  return profile.filter((_, i) => keep[i])
}

/** 把一段里程依脊線切開，回傳每一小段落在哪一種脊線上 */
function spinePieces(
  placed: ReturnType<typeof placeSpine>,
  sFrom: number,
  sTo: number,
): Array<{ kind: 'straight' | 'arc'; sFrom: number; sTo: number; segIndex: number }> {
  const out: Array<{ kind: 'straight' | 'arc'; sFrom: number; sTo: number; segIndex: number }> = []
  placed.forEach((seg, segIndex) => {
    const a = Math.max(sFrom, seg.sFrom)
    const b = Math.min(sTo, seg.sTo)
    if (b - a <= 1e-6) return
    out.push({ kind: seg.kind, sFrom: a, sTo: b, segIndex })
  })
  return out.sort((x, y) => x.sFrom - y.sFrom)
}

/**
 * 走進彎道要佔多少比例才算「經過」。
 *
 * 圓角軌道是四分之一，畫不出半段弧，所以經過就得佔滿整段。門檻放太低的後果實測
 * 過：SD-5 只走過那個轉角的四分之一，卻被畫成整整 90 度的弧，而且它在第三股、
 * 半徑比主線大一倍多，整條甩到主線外面去，比主線還顯眼。過半才算經過。
 */
const ARC_COVERAGE_MIN = 0.5

/**
 * 把太短的一段併進隔壁。
 *
 * 簡化過的剖面還是會留下幾像素的段：一段 8 像素的斜接、一段 1.6 像素的直線，在圖上
 * 只是接縫處的雜訊，不像一塊軌道。門檻以下的段就把它的端點拿掉，長度讓給隔壁那一
 * 段——併掉會讓橫向偏移少一個轉折，但那個轉折本來也短到看不出來。
 *
 * 只動中間的點，兩端保留：頭尾一動，這條線就接不上鄰居了。
 */
function mergeShortRuns(
  prof: Array<[number, number]>,
  minS: number,
): Array<[number, number]> {
  if (prof.length < 3 || !(minS > 0)) return prof
  const out = prof.map((p) => [p[0], p[1]] as [number, number])
  let i = 0
  while (out.length > 2 && i + 1 < out.length) {
    if (out[i + 1]![0] - out[i]![0] >= minS) {
      i += 1
      continue
    }
    if (i + 2 < out.length) {
      // 併進後面那一段
      out.splice(i + 1, 1)
    } else if (i > 0) {
      // 這是最後一段：尾點得留著，改拿掉前一個轉折
      out.splice(i, 1)
      i -= 1
    } else {
      break
    }
  }
  return out
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

function layoutOnce(
  result: TrackGenResult,
  settings: TrackGenSettings,
  block: TrackGenBlockSize | undefined,
  alongX: number,
  alongY: number,
  box: { wPx: number; hPx: number } | undefined,
): TrackGenLayout {
  /*
   * 版面<strong>鋪滿軌道生成元件的框</strong>，大小不由參數決定。
   *
   * 使用者已經把路網圖拉到滿意的大小了；按下生成之後看到的就該是同一塊區域的簡化
   * 版，不必再去湊「一塊幾像素」。所以沿線的比例尺是解出來的：兩軸各自試算，讓脊線
   * 的外框剛好等於框的長寬。
   *
   * 三個參數各管各的，互不影響大小：
   *
   *   軌道寬度       帶子多粗（連同圓角、斜接、分岔一起），以及一股佔多寬
   *   橫向一塊代表   橫的路每幾公尺切一刀
   *   縱向一塊代表   縱的路每幾公尺切一刀
   */
  const bandPx = block ? block.trackWidthPx : 0
  /*
   * 股距與軌道寬<strong>分開</strong>。
   *
   * 綁在一起時，軌道寬會連帶決定整張圖的高度：股數 × 軌道寬再加上轉角外緣就是下限，
   * 壓縮沿線救不了——實測 1180 × 300 的框配軌道寬 26 只能生出 1180 × 321。可是使用者
   * 調寬度只是要讓車子在圖上看得清楚，不該動到幾何。
   *
   * 所以股距改成由框的高度反推：橫向最多吃掉框高的三分之一，剩下的留給折回來的路。
   * 框夠高時仍然等於軌道寬（軌道剛好相鄰）；框太扁時股距會小於軌道寬，平行的軌道
   * 因此略為重疊——那是刻意的取捨，總比整張圖溢出框好。
   */
  let levels = 1
  for (const line of result.lines) {
    for (const [, lat] of line.profile) {
      levels = Math.max(levels, Math.round(Math.abs(lat) / LANE_W_M) + 1)
    }
  }
  const levelPx = block
    ? Math.max(2, Math.min(bandPx, (box ? box.hPx : Infinity) * 0.35 / levels))
    : 0
  const lt = block ? levelPx / LANE_W_M : settings.lateralScale
  /*
   * 轉角半徑跟著<strong>股距</strong>走，不是軌道寬。
   *
   * 圓角軌道的外緣半徑還要加上該股的橫向偏移，所以基準給小了，內側的弧會被夾到
   * 幾乎沒有；三個股距是最裡面那條還畫得出來的下限。跟著軌道寬走的話，把軌道畫粗
   * 一點就會連帶把兩個轉角一起脹大，高度又被吃掉。
   */
  const cornerRPx = block ? levelPx * 3 : settings.cornerRadiusM

  /*
   * 一段軌道至少要有多長才畫得出來（里程公尺）。
   *
   * 比軌道還窄的一塊不像軌道，像接縫；實測生出過 1.6 × 24 的一般軌道與 8 × 31 的
   * 斜接軌道。門檻取一個軌道寬，以下的段併進隔壁。
   */
  const minRunXM = block ? levelPx / Math.max(1e-6, alongX) : LANE_W_M
  const minRunYM = block ? levelPx / Math.max(1e-6, alongY) : LANE_W_M
  /** 吸附與併段用同一個門檻，取兩軸較寬鬆的那個才不會把橫向的段誤併 */
  const minRunM = Math.min(minRunXM, minRunYM)

  const placed = placeSpine(result.spine, alongX, alongY, cornerRPx)
  const shapes: LayoutShape[] = []
  const pts: Vec2[] = []

  /** 把里程吸到最近的脊線段邊界（差在一個門檻內才吸） */
  const boundaries = placed.flatMap((q) => [q.sFrom, q.sTo])
  const snapStation = (sq: number) => {
    let best = sq
    let bd = minRunM
    for (const b of boundaries) {
      const d = Math.abs(sq - b)
      if (d < bd) {
        bd = d
        best = b
      }
    }
    return best
  }


  let lineKey = ''
  let lineLengthM = 0
  /** 這條線畫多寬（版面公尺）——直接來自車道寬，不另外訂 */
  let bandW = LANE_W_M

  /* ── 三種元件各一支產生函式 ─────────────────────────────── */

  const addRect = (
    name: string,
    role: LaneRole,
    sFrom: number,
    sTo: number,
    latM: number,
    realLatFromM: number,
    realLatToM = realLatFromM,
  ) => {
    const p0 = placePoint(sFrom, latM, placed, lt)
    const p1 = placePoint(sTo, latM, placed, lt)
    const lengthM = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    if (lengthM < 0.5) return
    const rect: LayoutRect = {
      kind: 'rect',
      name,
      role,
      lineKey,
      lineLengthM,
      realLatFromM,
      realLatToM,
      samples: [p0, p1],
      centre: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
      lengthM,
      widthM: bandW,
      rotationDeg: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI,
      sFrom,
      sTo,
    }
    shapes.push(rect)
    pts.push(...rectCorners(rect))
  }

  const addCorner = (
    name: string,
    role: LaneRole,
    segIndex: number,
    latM: number,
    realLatM: number,
  ) => {
    const seg = placed[segIndex]
    if (!seg || seg.kind !== 'arc') return
    const centreRadius = Math.abs(seg.radiusPx - seg.sign * latM * lt)
    const outerR = centreRadius + bandW / 2
    const p0 = placePoint(seg.sFrom, latM, placed, lt)
    const p1 = placePoint(seg.sTo, latM, placed, lt)
    const samples: Vec2[] = []
    for (let i = 0; i <= 12; i += 1) {
      samples.push(placePoint(seg.sFrom + ((seg.sTo - seg.sFrom) * i) / 12, latM, placed, lt))
    }
    const { geometry, box } = fitCornerAt(seg.centre, outerR, bandW, p0, p1)
    shapes.push({
      kind: 'corner',
      name,
      role,
      lineKey,
      lineLengthM,
      realLatFromM: realLatM,
      realLatToM: realLatM,
      samples,
      geometry,
      box,
      outerRadiusM: outerR,
      sFrom: seg.sFrom,
      sTo: seg.sTo,
    })
    pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
  }

  const addTaper = (
    name: string,
    role: LaneRole,
    sA: number,
    latA: number,
    sB: number,
    latB: number,
    alongDeg: number,
  ) => {
    const pa = placePoint(sA, latA, placed, lt)
    const pb = placePoint(sB, latB, placed, lt)
    const { geometry, box } = fitTaper(pa, pb, bandW, alongDeg)
    shapes.push({
      kind: 'taper',
      name,
      role,
      lineKey,
      lineLengthM,
      realLatFromM: latA,
      realLatToM: latB,
      samples: [pa, pb],
      geometry,
      box,
      sFrom: sA,
      sTo: sB,
    })
    pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
  }

  /**
   * 路口：一進兩出。
   *
   * 側線岔出去時，用一個分岔軌道表示「主線繼續、同時分出一條」。先前只有斜接可用，
   * 主線與側線在路口各畫各的，兩片就互相穿透。
   */
  const addSwitch = (
    name: string,
    role: LaneRole,
    sA: number,
    latA: number,
    sB: number,
    latB: number,
    alongDeg: number,
  ) => {
    const stem = placePoint(sA, latA, placed, lt)
    const main = placePoint(sB, latA, placed, lt)
    const branch = placePoint(sB, latB, placed, lt)
    const fit = fitSwitchAt(stem, main, branch, bandW, alongDeg)
    if (!fit) return false
    shapes.push({
      kind: 'switch',
      name,
      role,
      lineKey,
      lineLengthM,
      realLatFromM: latA,
      realLatToM: latB,
      samples: [stem, branch],
      geometry: fit.geometry,
      box: fit.box,
      sFrom: sA,
      sTo: sB,
    })
    pts.push(
      { x: fit.box.xM, y: fit.box.yM },
      { x: fit.box.xM + fit.box.wM, y: fit.box.yM + fit.box.hM },
    )
    return true
  }

  /** 一段「橫向偏移固定」的區間 → 依脊線拆成一般軌道與圓角軌道 */
  const emitFlat = (
    role: LaneRole,
    latM: number,
    sFrom: number,
    sTo: number,
    nextName: () => string,
  ) => {
    for (const piece of spinePieces(placed, sFrom, sTo)) {
      const seg = placed[piece.segIndex]!
      if (piece.kind === 'arc') {
        const cover = (piece.sTo - piece.sFrom) / Math.max(1e-6, seg.sTo - seg.sFrom)
        if (cover < ARC_COVERAGE_MIN) continue
        addCorner(nextName(), role, piece.segIndex, latM, latM)
        continue
      }
      /*
       * 每一塊都剛好是使用者指定的長度，除不盡的餘數留給最後一塊。
       *
       * 先前是把餘數平均攤給整段的每一塊，結果要 150 公尺卻生出 155–197 的塊——
       * 使用者填的數字在畫面上根本兌現不了。寧可最後一塊短一截，也不要每一塊都不是
       * 自己填的長度。
       *
       * 餘數短到不成一塊時併進前一塊。門檻原本是一塊的 2%，太鬆——實測留下 1.6 × 24
       * 的一般軌道，比軌道還窄，看起來是接縫不是軌道。改用與其他地方同一個門檻
       * minRunM：以下的餘數讓前一塊吃掉。代價是每一段直線的最後一塊最多長出一個
       * minRun（一塊 150 × 30 時是 30 px，兩成），換掉的是一條看不出是軌道的碎片。
       */
      const span = piece.sTo - piece.sFrom
      // 橫的路與縱的路各有自己的「一塊代表幾公尺」
      const alongThis =
        seg.kind === 'straight' ? Math.abs(seg.dir.x) >= Math.abs(seg.dir.y) : true
      const perBlockM = Math.max(
        1,
        block
          ? alongThis
            ? block.metersPerBlockX
            : block.metersPerBlockY
          : settings.blockLengthM,
      )
      const n = blocksInSpan(span, perBlockM, alongThis ? minRunXM : minRunYM)
      for (let k = 0; k < Math.max(1, n); k += 1) {
        const from = piece.sFrom + k * perBlockM
        const to = k === n - 1 ? piece.sTo : Math.min(piece.sTo, from + perBlockM)
        addRect(nextName(), role, from, to, latM, latM)
      }
    }
  }

  const hdgAt = (s: number) => {
    const seg = placed.find((q) => q.kind === 'straight' && s >= q.sFrom && s <= q.sTo)
    if (!seg || seg.kind !== 'straight') return null
    return Math.round((Math.atan2(seg.dir.y, seg.dir.x) * 180) / Math.PI / 90) * 90
  }

  /**
   * 把每一段斜的改成指定斜率：需要多長的里程由橫移量反推。
   *
   * 只動轉折點的<strong>里程</strong>，橫向偏移原封不動，所以線還是接得上，兩側的直線
   * 段自動讓出或收回那一段。撐不開時就撐到隔壁那一點為止——寧可比目標斜一點，也不能
   * 跨過去把別人的段吃掉。
   */
  const applySlope = (
    prof: Array<[number, number]>,
    flatEps: number,
  ): Array<[number, number]> => {
    if (!block || prof.length < 2) return prof
    const n = TAPER_SLOPE_N
    const out = prof.map((p) => [p[0], p[1]] as [number, number])
    for (let i = 0; i + 1 < out.length; i += 1) {
      const dLat = Math.abs(out[i + 1]![1] - out[i]![1])
      if (dLat <= flatEps) continue
      const mid = (out[i]![0] + out[i + 1]![0]) / 2
      const hdg = hdgAt(mid)
      const alongPx = hdg === null || isAlongX(hdg) ? alongX : alongY
      const needM = (dLat * lt * n) / Math.max(1e-6, alongPx)
      const lo = i > 0 ? out[i - 1]![0] : out[0]![0]
      const hi = i + 2 < out.length ? out[i + 2]![0] : out[out.length - 1]![0]
      let a = mid - needM / 2
      let b = mid + needM / 2
      if (a < lo) {
        a = lo
        b = Math.min(hi, a + needM)
      }
      if (b > hi) {
        b = hi
        a = Math.max(lo, b - needM)
      }
      out[i]![0] = a
      out[i + 1]![0] = b
    }
    return out
  }

  /* ── 每一條線都走同一條路 ───────────────────────────────── */

  const seen = new Set<string>()

  for (const line of result.lines) {
    const isReference = line.key === result.lines[0]?.key
    if (!isReference && !settings.showSidings) continue
    const prof = [...line.profile].sort((a, b) => a[0] - b[0])
    if (prof.length < 2) continue

    lineKey = line.key
    lineLengthM = line.lengthM
    bandW = block
      ? bandPx
      : Math.max(0.5, (line.widthM || LANE_W_M) * settings.trackWidthScale)

    /*
     * 畫的是<strong>第幾股</strong>，不是真實的橫向公尺數。
     *
     * 橫向被放大得很兇（一股就是一個軌道寬），真實幾何裡幾公尺的緩慢漂移放大之後
     * 變成畫面上一大段斜的——實測原始中心線幾乎是兩條平直的線、只有一處渡線，生出來
     * 卻整片都在斜。所以吸到整數股：平的地方就真的是平的，換股才有斜接軌道，一步
     * 剛好一個軌道寬。
     *
     * 脊線把緩彎拉直後的偏離（refDeviation）也不再加回來。它是真實公尺，同樣會被
     * 橫向倍率放大好幾倍，畫出來是整條線在飄，而那個彎在圖上已經由轉角表達過了。
     */
    const levelM = LANE_W_M
    const withDev: Array<[number, number]> = prof.map(([sq, lat]) => [
      sq,
      Math.round(lat / levelM) * levelM,
    ])
    /*
     * 轉折點先吸到脊線段的邊界，再併掉太短的段。
     *
     * 剩下的碎片幾乎都是這樣來的：一段直線跨過脊線段的交界只跨進去一點點，那一點點
     * 就自成一塊——實測 1.7 × 24 的一般軌道。把差不到一個門檻的轉折點吸到交界上，
     * 那一小截就歸隔壁那一段，碎片自然不存在。頭尾不吸，一動這條線就接不上鄰居。
     */
    const flatEps = (line.widthM || LANE_W_M) * 0.25
    const rough = simplifyProfile(withDev, flatEps)
    const snapped: Array<[number, number]> = rough.map((p, i) =>
      i === 0 || i === rough.length - 1 ? p : [snapStation(p[0]), p[1]],
    )
    const merged = mergeShortRuns(snapped, minRunM)
    /*
     * 換股道的斜度由參數決定，不照 .xodr 的真實過渡長度。
     *
     * 版面的橫向被放大得很兇：一塊 83 px 代表 50 公尺時沿線是 1.66 px／公尺，而軌道
     * 寬 53 px 換算成 15.8 px／公尺，兩軸差 9.5 倍。真實 1:30 的渡線照抄過來就變成
     * 1:3，看起來像折斷——使用者第一眼就說「斜接軌道太傾斜」。
     *
     * 所以反過來做：斜率先定死成 1:N，需要多長的里程由橫移量反推，兩側的直線段讓出
     * （或收回）那一段。移動的是轉折點的里程，不是橫向偏移，所以線還是接得上。
     */
    const simplified = applySlope(merged, flatEps)

    /*
     * 太短的線整條不畫。
     *
     * 路口裡那些連接用的短車道，畫出來就是一兩塊、幾十像素——而且它與主線差好幾股，
     * 那個岔出動作擠在幾十像素裡，畫出來是一根尖刺。實測 T3 的 L5～L10 各只有 26～
     * 68 px，全部都是這種東西；主線 L1／L2 是 2416／1750 px，差兩個數量級。
     *
     * 門檻取八個股距：夠畫出一個像樣的分岔加一小段軌道。簡圖要的是看得懂的幾何，
     * 不是把每一條連接車道都交代掉。
     */
    if (block) {
      let lenPx = 0
      for (let i = 1; i < simplified.length; i += 1) {
        const a = placePoint(simplified[i - 1]![0], simplified[i - 1]![1], placed, lt)
        const b = placePoint(simplified[i]![0], simplified[i]![1], placed, lt)
        lenPx += Math.hypot(b.x - a.x, b.y - a.y)
      }
      if (lenPx < levelPx * 8) continue
    }

    const sig = `${Math.round(prof[0]![0])}:${Math.round(prof[prof.length - 1]![0])}:${simplified
      .map((p) => Math.round(p[1]))
      .join(',')}`
    if (seen.has(sig)) continue
    seen.add(sig)

    let seq = 0
    const nextName = () => {
      seq += 1
      return `${line.key}-${String(seq).padStart(2, '0')}`
    }

    /*
     * 折線的每一段：橫向幾乎沒變就是一般軌道／圓角軌道，有斜率就是斜接軌道。
     *
     * 斜接軌道是一段直的平行四邊形，只能放在直線脊線段上；落在彎道上的那一段改用
     * 平均橫向偏移當作固定值，畫成圓角軌道。
     */
    for (let i = 0; i + 1 < simplified.length; i += 1) {
      const [sA, latA] = simplified[i]!
      const [sB, latB] = simplified[i + 1]!
      if (sB - sA < 0.5) continue
      const along = hdgAt((sA + sB) / 2)
      const sloped = Math.abs(latB - latA) > flatEps && along !== null
      if (!sloped) {
        emitFlat(line.role, (latA + latB) / 2, sA, sB, nextName)
        continue
      }
      // 斜的那一段若跨進彎道，彎道那一截退回固定偏移
      const host = placed.find((q) => q.kind === 'straight' && sA >= q.sFrom && sB <= q.sTo)
      if (!host) {
        emitFlat(line.role, (latA + latB) / 2, sA, sB, nextName)
        continue
      }
      seq += 1
      /*
       * 線頭與線尾的那一段斜的是<strong>岔出／併回</strong>，不是換股道：一條側線在
       * 路口離開主線，主線並沒有跟著走。用分岔軌道畫，主線那一支就留在圖上，不會
       * 變成兩片互相穿透的斜接。中間的斜段仍然是換股道，維持斜接。
       */
      const name = `${line.key}X-${String(seq).padStart(2, '0')}`
      const atEnd = i === 0 || i + 2 === simplified.length
      /*
       * 梗放在<strong>比較靠近主線</strong>的那一端。哪一端是路口不看順序：側線可能
       * 從頭岔出去，也可能到尾才併回來，但靠主線的那一端一定是橫向偏移比較小的。
       */
      const stemFirst = Math.abs(latA) <= Math.abs(latB)
      if (
        atEnd &&
        addSwitch(
          name,
          line.role,
          stemFirst ? sA : sB,
          stemFirst ? latA : latB,
          stemFirst ? sB : sA,
          stemFirst ? latB : latA,
          along,
        )
      ) {
        continue
      }
      addTaper(name, line.role, sA, latA, sB, latB, along)
    }
  }

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    shapes,
    bounds: {
      xMin: Math.min(...xs),
      yMin: Math.min(...ys),
      xMax: Math.max(...xs),
      yMax: Math.max(...ys),
    },
  }
}

export function rectPolygon(r: LayoutRect): Vec2[] {
  return rectCorners(r)
}

/**
 * 排版，並讓結果<strong>鋪滿指定的框</strong>。
 *
 * 沿線的比例尺是解出來的，不是使用者填的：他已經把路網圖拉到滿意的大小了，按下生成
 * 之後看到的就該是同一塊區域的簡化版。兩軸互相牽動（轉角同時吃掉長與寬，帶寬又撐開
 * 橫向），沒有解析解，所以直接<strong>排幾次逼近</strong>——照實際外框與目標的比值
 * 調整倍率，收斂得很快。
 *
 * 拿真的排版結果去逼近，不是拿脊線估：脊線沒有算轉角的外緣、帶寬與最外側的股道，
 * 估出來的高度差了三成。
 */
export function layoutTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
  block?: TrackGenBlockSize,
  /** 要鋪滿的框（軌道生成元件的大小，畫布像素） */
  box?: { wPx: number; hPx: number },
): TrackGenLayout {
  if (!block || !box) return layoutOnce(result, settings, block, 1, 1, box)
  let ax = 1
  let ay = 1
  let out = layoutOnce(result, settings, block, ax, ay, box)
  for (let i = 0; i < 6; i += 1) {
    const w = Math.max(1, out.bounds.xMax - out.bounds.xMin)
    const h = Math.max(1, out.bounds.yMax - out.bounds.yMin)
    if (Math.abs(w - box.wPx) < 1 && Math.abs(h - box.hPx) < 1) break
    // 倍率只影響沿線的部分，帶寬與轉角是定值，所以用比值修正會過頭一點——收斂即可
    ax = Math.max(1e-4, ax * (box.wPx / w))
    ay = Math.max(1e-4, ay * (box.hPx / h))
    out = layoutOnce(result, settings, block, ax, ay, box)
  }
  return out
}
