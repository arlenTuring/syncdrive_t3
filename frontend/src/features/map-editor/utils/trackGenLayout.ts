import {
  placePoint,
  placeSpine,
  type TrackGenBlockSize,
  type TrackGenSettings,
} from './trackGenFacility'
import type { LaneRole, TrackGenResult, Vec2 } from './trackGenerator'
import {
  cornerArcCentrePx,
  cornerTrackEndsPx,
  taperTrackEndsPx,
  type CornerTrackGeometry,
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

export type LayoutShape = LayoutRect | LayoutCorner | LayoutTaper

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
function fitCorner(
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

export function layoutTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
  block?: TrackGenBlockSize,
): TrackGenLayout {
  /*
   * 使用者指定了一塊軌道多大時，整個版面改用<strong>畫布像素</strong>當單位：
   *
   *   橫向的路 1 公尺 → blockLengthXPx / metersPerBlockX 像素
   *   縱向的路 1 公尺 → blockLengthYPx / metersPerBlockY 像素
   *   橫向偏移 一股    → blockWidthPx 像素（軌道等寬且相鄰）
   *
   * 兩軸<strong>各自</strong>有「一塊多長」與「一塊代表幾公尺」：畫布通常又寬又扁，
   * 同一組數字套在兩軸上時，橫向還很寬鬆、縱向早就滿了。沒有指定時退回公尺版面。
   */
  const alongX = block ? block.blockLengthXPx / Math.max(1, block.metersPerBlockX) : 1
  const alongY = block ? block.blockLengthYPx / Math.max(1, block.metersPerBlockY) : 1
  // 一條車道寬（LANE_W_M 公尺）對應 blockWidthPx，兩軸都是像素才加得起來
  const lt = block ? block.blockWidthPx / LANE_W_M : settings.lateralScale
  /*
   * 轉角半徑也照使用者給的參數走：脊線半徑就是<strong>一塊軌道的長度</strong>，所以
   * 一個轉角在圖上約等於一塊，跟旁邊的直線塊看起來是同一個量級。
   *
   * 以前用的是 settings.cornerRadiusM（57 公尺）再乘上 alongScale。那個數字使用者
   * 在對話框裡看不到也改不了，而且乘上 alongScale 之後轉角大小其實綁在「一塊代表
   * 幾公尺」上——量出來 150 × 30 的塊配上 186 × 186 的轉角，轉角的高是軌道寬的
   * 六倍多，整體比例就歪在這裡。
   *
   * 外側股道的弧仍然比較大：同心弧本來就是這樣，第 n 股在半徑上多出 n 個軌道寬，
   * 這是幾何，不是參數沒吃到。
   */
  /*
   * 一段軌道至少要有多長才畫得出來（里程公尺）。
   *
   * 比軌道還窄的一塊不像軌道，像接縫；實測生出過 1.6 × 24 的一般軌道與 8 × 31 的
   * 斜接軌道。門檻取「一個軌道寬」與「四分之一塊」的大者，以下的段併進隔壁。
   */
  const minRunXM = block
    ? Math.max(block.blockWidthPx, block.blockLengthXPx * 0.25) / Math.max(1e-6, alongX)
    : LANE_W_M
  const minRunYM = block
    ? Math.max(block.blockWidthPx, block.blockLengthYPx * 0.25) / Math.max(1e-6, alongY)
    : LANE_W_M
  /** 吸附與併段用同一個門檻，取兩軸較寬鬆的那個才不會把橫向的段誤併 */
  const minRunM = Math.min(minRunXM, minRunYM)

  /*
   * 轉角接的是一橫一縱，方框又是正方形，所以取兩軸<strong>較短</strong>的那一塊。
   * 取長的那一邊會讓縱向壓縮的努力被轉角吃掉——轉角自己就佔掉一整塊的高度。
   */
  const cornerRPx = block
    ? Math.min(block.blockLengthXPx, block.blockLengthYPx)
    : settings.cornerRadiusM * alongX
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

  /*
   * 版面上的橫向偏移 ＝ 剖面的偏移 ＋ 參考線相對脊線的偏離。
   *
   * 脊線把緩彎拉直了，那段彎的量存在 refDeviation 裡；加回去，主線自己的緩彎才會
   * 變成幾段斜接軌道，而不是憑空消失。真實座標的還原不加這個值（那邊用的是剖面
   * 的原始偏移），兩者刻意分開。
   */
  const devAt = (sq: number) => {
    const d = result.refDeviation
    if (!d.length) return 0
    if (sq <= d[0]![0]) return d[0]![1]
    if (sq >= d[d.length - 1]![0]) return d[d.length - 1]![1]
    let lo = 0
    let hi = d.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (d[mid]![0] <= sq) lo = mid
      else hi = mid
    }
    const span = Math.max(1e-6, d[hi]![0] - d[lo]![0])
    const u = (sq - d[lo]![0]) / span
    return d[lo]![1] + (d[hi]![1] - d[lo]![1]) * u
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
    const { geometry, box } = fitCorner(seg.centre, outerR, bandW, p0, p1)
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
      const tail = alongThis ? minRunXM : minRunYM
      const full = Math.floor(span / perBlockM)
      const rest = span - full * perBlockM
      const n = full > 0 && rest < tail ? full : full + (rest > 0 ? 1 : 0)
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
      ? block.blockWidthPx
      : Math.max(0.5, (line.widthM || LANE_W_M) * settings.trackWidthScale)

    /*
     * 把剖面簡化成折線，容差取車道寬的四分之一：比這小的橫向擺動在簡圖上看不出來，
     * 留著只會生出一堆幾公尺長的碎片。
     */
    const withDev: Array<[number, number]> = prof.map(([sq, lat]) => [sq, lat + devAt(sq)])
    /*
     * 轉折點先吸到脊線段的邊界，再併掉太短的段。
     *
     * 剩下的碎片幾乎都是這樣來的：一段直線跨過脊線段的交界只跨進去一點點，那一點點
     * 就自成一塊——實測 1.7 × 24 的一般軌道。把差不到一個門檻的轉折點吸到交界上，
     * 那一小截就歸隔壁那一段，碎片自然不存在。頭尾不吸，一動這條線就接不上鄰居。
     */
    const rough = simplifyProfile(withDev, (line.widthM || LANE_W_M) * 0.25)
    const snapped: Array<[number, number]> = rough.map((p, i) =>
      i === 0 || i === rough.length - 1 ? p : [snapStation(p[0]), p[1]],
    )
    const simplified = mergeShortRuns(snapped, minRunM)
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
    const flatEps = (line.widthM || LANE_W_M) * 0.25
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
      addTaper(
        `${line.key}X-${String(seq).padStart(2, '0')}`,
        line.role,
        sA,
        latA,
        sB,
        latB,
        along,
      )
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
