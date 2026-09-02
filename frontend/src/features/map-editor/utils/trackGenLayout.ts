import { placePoint, placeSpine, type TrackGenSettings } from './trackGenFacility'
import type { LaneRole, ProjectedLine, TrackGenResult, Vec2 } from './trackGenerator'
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
 * 決定每一條線畫在第幾股。
 *
 * <h3>分群，不是照身分指派</h3>
 * 先前的做法是「最長的兩條當第 0、第 1 股，其餘側線照平均距離往外排」——那把
 * 「有兩條主線」寫死進演算法了。換一份路網就不成立，而且渡線的端點會吸到某條側線
 * 的平均位置上，畫出來接在半空中。
 *
 * 現在改成純資料：把<strong>所有線、所有取樣點</strong>的橫向偏移排序後分群，群與群
 * 之間的間隔超過大半個車道寬就切開。每一群就是一股，照橫向位置由小到大編號；
 * 參考線所在的那一群定為第 0 股。股距取相鄰群中心距離的中位數。
 */
function buildLevels(lines: ProjectedLine[]): {
  levelOf: (lateralM: number) => number
  spacingM: number
  count: number
} {
  /*
   * 只拿「停得住」的取樣點來分群。
   *
   * 換股道的那一段是連續掃過去的，它的取樣點會把股與股之間的空隙填滿；照全部的點
   * 分群，整條路網會被併成一群，換股道那件事就消失了——實測 10 條線一段斜接軌道
   * 都生不出來。所謂停得住，是指前後一小段裡橫向偏移幾乎沒變。
   */
  const dwell: number[] = []
  for (const line of lines) {
    const prof = [...line.profile].sort((a, b) => a[0] - b[0])
    for (let i = 0; i < prof.length; i += 1) {
      const lo = Math.max(0, i - 3)
      const hi = Math.min(prof.length - 1, i + 3)
      let min = Infinity
      let max = -Infinity
      for (let j = lo; j <= hi; j += 1) {
        min = Math.min(min, prof[j]![1])
        max = Math.max(max, prof[j]![1])
      }
      if (max - min <= LANE_W_M * 0.4) dwell.push(prof[i]![1])
    }
  }
  const samples = (dwell.length ? dwell : lines.flatMap((l) => l.profile.map((p) => p[1]))).sort(
    (a, b) => a - b,
  )
  if (!samples.length) return { levelOf: () => 0, spacingM: LANE_W_M, count: 1 }

  const gap = LANE_W_M * 0.75
  const groups: number[][] = [[samples[0]!]]
  for (let i = 1; i < samples.length; i += 1) {
    const v = samples[i]!
    const g = groups[groups.length - 1]!
    if (v - g[g.length - 1]! <= gap) g.push(v)
    else groups.push([v])
  }
  const centres = groups.map((g) => g[g.length >> 1]!)

  // 參考線的橫向偏移是 0，它所在的那一群就是第 0 股
  let zero = 0
  for (let i = 1; i < centres.length; i += 1) {
    if (Math.abs(centres[i]!) < Math.abs(centres[zero]!)) zero = i
  }

  const gaps: number[] = []
  for (let i = 1; i < centres.length; i += 1) gaps.push(centres[i]! - centres[i - 1]!)
  gaps.sort((a, b) => a - b)
  const spacingM = gaps.length ? gaps[gaps.length >> 1]! : LANE_W_M

  const levelOf = (lateralM: number) => {
    let best = 0
    for (let i = 1; i < centres.length; i += 1) {
      if (Math.abs(centres[i]! - lateralM) < Math.abs(centres[best]! - lateralM)) best = i
    }
    return best - zero
  }
  return { levelOf, spacingM: Math.max(LANE_W_M * 0.5, spacingM), count: centres.length }
}

/**
 * 把一條車道切成「股道不變」的一段一段。
 *
 * <h3>短段不能一律往前併</h3>
 * 渡線是連續漸變的：吸到整數股之後會得到一串各自只有幾公尺的小段。一律往前併的話
 * 整條渡線會被併成單一股道，換股道那件事就消失了——實測 10 條渡線一條斜接軌道都沒
 * 生出來。改成反覆挑<strong>最短</strong>的一段，併進股道比較接近的那個鄰居。
 *
 * 剖面的里程不保證遞增（車道方向與參考線相反時就是遞減），所以先排序。
 */
function laneRuns(
  lane: ProjectedLine,
  minRunM: number,
  levelOf: (lateralM: number) => number,
): Array<{ sFrom: number; sTo: number; level: number }> {
  const prof = [...lane.profile].sort((a, b) => a[0] - b[0])
  if (prof.length < 2) return []
  let runs: Array<{ sFrom: number; sTo: number; level: number }> = []
  for (const [s, lat] of prof) {
    const n = levelOf(lat)
    const last = runs[runs.length - 1]
    if (last && last.level === n) last.sTo = s
    else runs.push({ sFrom: last ? last.sTo : s, sTo: s, level: n })
  }

  const coalesce = () => {
    const out: typeof runs = []
    for (const r of runs) {
      const last = out[out.length - 1]
      if (last && last.level === r.level) last.sTo = r.sTo
      else out.push({ ...r })
    }
    runs = out
  }
  coalesce()

  while (runs.length > 1) {
    let worst = -1
    let worstLen = Infinity
    for (let i = 0; i < runs.length; i += 1) {
      const len = runs[i]!.sTo - runs[i]!.sFrom
      if (len < worstLen) {
        worstLen = len
        worst = i
      }
    }
    if (worstLen >= minRunM) break
    const prev = runs[worst - 1]
    const next = runs[worst + 1]
    const r = runs[worst]!
    // 併進股道比較接近的鄰居；一樣近就併進比較長的那一個
    const dPrev = prev ? Math.abs(prev.level - r.level) : Infinity
    const dNext = next ? Math.abs(next.level - r.level) : Infinity
    const intoPrev =
      dPrev < dNext ||
      (dPrev === dNext && !!prev && (!next || prev.sTo - prev.sFrom >= next.sTo - next.sFrom))
    if (intoPrev && prev) prev.sTo = r.sTo
    else if (next) next.sFrom = r.sFrom
    else break
    runs.splice(worst, 1)
    coalesce()
  }
  return runs.filter((r) => r.sTo - r.sFrom > 1)
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

export function layoutTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
): TrackGenLayout {
  const lt = settings.lateralScale
  const placed = placeSpine(result.spine, 1, settings.cornerRadiusM)
  const bandW = LANE_W_M * lt
  const shapes: LayoutShape[] = []
  const pts: Vec2[] = []

  const { levelOf, spacingM, count } = buildLevels(result.lines)
  const latOfLevel = (level: number) => level * spacingM
  /** 股道編號從最外側那一股算起，1 開始——只是個名字，沒有方向含意 */
  const trackNo = (level: number) => level + Math.ceil(count / 2)

  /* ── 三種元件各一支產生函式 ─────────────────────────────── */

  let lineKey = ''
  let lineLengthM = 0

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
    realLatFromM: number,
    realLatToM: number,
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
      realLatFromM,
      realLatToM,
      samples: [pa, pb],
      geometry,
      box,
      sFrom: sA,
      sTo: sB,
    })
    pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
  }

  /** 一段「股道不變」的區段 → 依脊線拆成一般軌道與圓角軌道 */
  const emitRun = (
    role: LaneRole,
    level: number,
    sFrom: number,
    sTo: number,
    realLatAt: (s: number) => number,
    nextName: () => string,
  ) => {
    const latM = latOfLevel(level)
    for (const piece of spinePieces(placed, sFrom, sTo)) {
      const seg = placed[piece.segIndex]!
      if (piece.kind === 'arc') {
        const cover = (piece.sTo - piece.sFrom) / Math.max(1e-6, seg.sTo - seg.sFrom)
        if (cover < ARC_COVERAGE_MIN) continue
        addCorner(nextName(), role, piece.segIndex, latM, realLatAt((seg.sFrom + seg.sTo) / 2))
        continue
      }
      const span = piece.sTo - piece.sFrom
      const n = Math.max(1, Math.round(span / Math.max(1, settings.blockLengthM)))
      const step = span / n
      for (let k = 0; k < n; k += 1) {
        const a = piece.sFrom + k * step
        const b = a + step
        addRect(nextName(), role, a, b, latM, realLatAt(a), realLatAt(b))
      }
    }
  }

  /* ── 每一條線都走同一條路 ───────────────────────────────── */

  for (const line of result.lines) {
    /*
     * 兩個顯示開關都是<strong>結構</strong>上的，不是身分上的：
     *   側線 ＝ 參考線以外的線（參考線就是最長那條，資料決定的）
     *   渡線 ＝ 換股道的那一段斜接軌道
     */
    const isReference = line.key === result.lines[0]?.key
    if (!isReference && !settings.showSidings) continue
    lineKey = line.key
    lineLengthM = line.lengthM
    const prof = [...line.profile].sort((a, b) => a[0] - b[0])
    if (prof.length < 2) continue

    const realLatAt = (s: number) => {
      let best = prof[0]!
      for (const p of prof) if (Math.abs(p[0] - s) < Math.abs(best[0] - s)) best = p
      return best[1]
    }

    const span = prof[prof.length - 1]![0] - prof[0]![0]
    const runs = laneRuns(line, Math.min(12, span / 3), levelOf)
    if (!runs.length) continue

    /*
     * 換股道那一段由斜接軌道佔住，兩側的區段各自讓出位置。
     *
     * 長度取「實際換股用掉的里程」與「橫移量」的較大者：橫向放大之後，二十公尺內
     * 換三股會橫移近百公尺，照實畫是一根幾乎垂直、穿過其他股道的尖刺；撐開之後最陡
     * 就是 45 度。撐開後不可以跨進彎道——斜接軌道是一段直的平行四邊形，兩端一個落在
     * 直線、一個落在弧上，中間那條直線會橫切過整個轉角。
     */
    const trims = runs.map(() => ({ before: 0, after: 0 }))
    const tapers: Array<{ sA: number; sB: number; i: number; alongDeg: number }> = []
    for (let i = 0; i + 1 < runs.length; i += 1) {
      const a = runs[i]!
      const b = runs[i + 1]!
      const sc = (a.sTo + b.sFrom) / 2
      const host = placed.find((q) => q.kind === 'straight' && sc >= q.sFrom && sc <= q.sTo)
      if (!host || host.kind !== 'straight') continue
      const latDelta = Math.abs(latOfLevel(a.level) - latOfLevel(b.level)) * lt
      let half = Math.max(b.sFrom - a.sTo, latDelta) / 2
      half = Math.min(half, sc - host.sFrom, host.sTo - sc)
      if (half * 2 < bandW * 0.4) continue
      trims[i]!.after = a.sTo - (sc - half)
      trims[i + 1]!.before = sc + half - b.sFrom
      tapers.push({
        sA: sc - half,
        sB: sc + half,
        i,
        alongDeg:
          Math.round((Math.atan2(host.dir.y, host.dir.x) * 180) / Math.PI / 90) * 90,
      })
    }

    let seq = 0
    const nameAt = (level: number) => () => {
      seq += 1
      return `${line.key}T${trackNo(level)}-${String(seq).padStart(2, '0')}`
    }

    runs.forEach((run, i) => {
      const from = run.sFrom + Math.max(0, trims[i]!.before)
      const to = run.sTo - Math.max(0, trims[i]!.after)
      if (to - from <= 1e-6) return
      emitRun(line.role, run.level, from, to, realLatAt, nameAt(run.level))
    })

    for (const t of settings.showCrossovers ? tapers : []) {
      seq += 1
      addTaper(
        `${line.key}X-${String(seq).padStart(2, '0')}`,
        line.role,
        t.sA,
        latOfLevel(runs[t.i]!.level),
        t.sB,
        latOfLevel(runs[t.i + 1]!.level),
        realLatAt(t.sA),
        realLatAt(t.sB),
        t.alongDeg,
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
