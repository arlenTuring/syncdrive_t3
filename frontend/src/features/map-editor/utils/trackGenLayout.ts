import { placePoint, placeSpine, type TrackGenSettings } from './trackGenFacility'
import type { LaneRole, ProjectedLane, TrackGenResult, Vec2 } from './trackGenerator'
import {
  cornerArcCentrePx,
  cornerTrackEndsPx,
  taperTrackEndsPx,
  MAX_TAPER_OFFSET,
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
): { geometry: TaperTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  let best: {
    geometry: TaperTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null

  for (const entryDeg of QUARTERS) {
    for (const [ta, tb] of [
      [p0, p1],
      [p1, p0],
    ] as Array<[Vec2, Vec2]>) {
      // 把目標向量轉回形狀自己的座標系
      const v = rotate({ x: tb.x - ta.x, y: tb.y - ta.y }, -entryDeg)
      if (v.x <= 1e-6 || v.y < -1e-6) continue
      const dx = v.x
      const dy = Math.max(0, v.y)
      const len = Math.hypot(dx, dy)
      const f = Math.min((bandWM * len) / dx, 1e6)
      const W = dx
      const H = dy + f
      const offsetRatio = Math.max(0, Math.min(MAX_TAPER_OFFSET, dy / Math.max(1e-6, H)))
      const geometry: TaperTrackGeometry = { offsetRatio, entryDeg }
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
    geometry: { offsetRatio: 0, entryDeg: 0 },
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
 * <h3>為什麼不能直接除以股距四捨五入</h3>
 * 真實的側線可以岔到離主線幾十公尺遠，除下去會得到第 8、第 9 股，夾到上限之後
 * 兩條不同的側線又落在同一股上，畫出來整整疊在一起——實測 SD-5 的兩條就是這樣。
 * 簡圖要表達的是<strong>順序</strong>不是距離，所以照實際橫向距離排序，由主線往外
 * 一格一格發號碼。
 */
function buildLaneLevels(
  lanes: ProjectedLane[],
  mainLateralM: number,
): { levelOf: (lateralM: number) => number } {
  const mean = (l: ProjectedLane) =>
    l.profile.reduce((a, p) => a + p[1], 0) / Math.max(1, l.profile.length)

  const sidings = lanes.filter((l) => l.role === 'siding')
  // 代表性橫向距離：主線兩條先佔 0 與 1
  const reps: Array<{ level: number; lateralM: number }> = [
    { level: 0, lateralM: 0 },
    { level: 1, lateralM: mainLateralM },
  ]

  const lo = Math.min(0, mainLateralM)
  const hi = Math.max(0, mainLateralM)
  const outer = sidings.filter((l) => mean(l) > hi).sort((a, b) => mean(a) - mean(b))
  const inner = sidings.filter((l) => mean(l) < lo).sort((a, b) => mean(b) - mean(a))
  outer.forEach((l, i) => reps.push({ level: 2 + i, lateralM: mean(l) }))
  inner.forEach((l, i) => reps.push({ level: -1 - i, lateralM: mean(l) }))

  const levelOf = (lateralM: number) => {
    let best = reps[0]!
    for (const r of reps) {
      if (Math.abs(r.lateralM - lateralM) < Math.abs(best.lateralM - lateralM)) best = r
    }
    return best.level
  }
  return { levelOf }
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
  lane: ProjectedLane,
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

  const mainLateral = result.blocks[0]?.lateralM ?? LANE_W_M
  const { levelOf } = buildLaneLevels(result.lanes, mainLateral)
  const latOfLevel = (level: number) => level * mainLateral

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
  ) => {
    const pa = placePoint(sA, latA, placed, lt)
    const pb = placePoint(sB, latB, placed, lt)
    const { geometry, box } = fitTaper(pa, pb, bandW)
    shapes.push({
      kind: 'taper',
      name,
      role,
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

  /**
   * 一段「股道不變」的區段 → 依脊線拆成一般軌道與圓角軌道。
   *
   * subdivide 是主線用的：直線段再依「每塊目標長度」切成 D01／U01… 那些塊。
   */
  const emitRun = (
    tag: string,
    role: LaneRole,
    level: number,
    sFrom: number,
    sTo: number,
    realLatAt: (s: number) => number,
    subdivide: number | null,
    nameAt: ((index: number) => string) | null,
  ) => {
    const latM = latOfLevel(level)
    let n = 0
    for (const piece of spinePieces(placed, sFrom, sTo)) {
      const seg = placed[piece.segIndex]!
      if (piece.kind === 'arc') {
        // 圓角軌道是四分之一：擦到一點邊不算經過，經過就佔滿整段
        const cover = (piece.sTo - piece.sFrom) / Math.max(1e-6, seg.sTo - seg.sFrom)
        if (cover < ARC_COVERAGE_MIN) continue
        addCorner(nameAt ? nameAt(n++) : `${tag}.C`, role, piece.segIndex, latM, realLatAt((seg.sFrom + seg.sTo) / 2))
        continue
      }
      const span = piece.sTo - piece.sFrom
      const count = subdivide ? Math.max(1, Math.round(span / subdivide)) : 1
      const step = span / count
      for (let k = 0; k < count; k += 1) {
        const a = piece.sFrom + k * step
        const b = a + step
        addRect(
          nameAt ? nameAt(n++) : count > 1 ? `${tag}.${k + 1}` : tag,
          role,
          a,
          b,
          latM,
          realLatAt(a),
          realLatAt(b),
        )
      }
    }
  }

  /* ── 主線：股道固定，整條走一次 ─────────────────────────── */

  const mainRealLat = (role: LaneRole) => {
    const pts2 = result.lanes
      .filter((l) => l.role === role)
      .flatMap((l) => l.profile)
      .sort((a, b) => a[0] - b[0])
    if (!pts2.length) return () => 0
    return (s: number) => {
      if (s <= pts2[0]![0]) return pts2[0]![1]
      if (s >= pts2[pts2.length - 1]![0]) return pts2[pts2.length - 1]![1]
      let lo = 0
      let hi = pts2.length - 1
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1
        if (pts2[mid]![0] <= s) lo = mid
        else hi = mid
      }
      const w = Math.max(1e-6, pts2[hi]![0] - pts2[lo]![0])
      const u = (s - pts2[lo]![0]) / w
      return pts2[lo]![1] + (pts2[hi]![1] - pts2[lo]![1]) * u
    }
  }

  /*
   * 主線的塊名沿用生成結果裡的編號（D01／U01…）。那份編號就是「直線段依每塊長度
   * 切開、彎道整段一塊」，與這裡的規則一致，直接照著發名字即可。
   */
  for (const [level, role, names] of [
    [0, 'down', result.blocks.map((b) => b.nameDown)],
    [1, 'up', result.blocks.map((b) => b.nameUp)],
  ] as Array<[number, LaneRole, string[]]>) {
    emitRun(
      role === 'down' ? 'D' : 'U',
      role,
      level,
      0,
      result.totalM,
      mainRealLat(role),
      settings.blockLengthM,
      (i) => names[i] ?? `${role === 'down' ? 'D' : 'U'}${String(i + 1).padStart(2, '0')}`,
    )
  }

  /* ── 側線與渡線：同一條規則，只是股道會變 ───────────────── */

  /*
   * 同一條渡線在 OpenDRIVE 裡有正反兩個方向的車道，投影出來是同一段里程、同一組
   * 股道。兩條都畫會疊在一起，看起來像一坨有缺口的方塊——簡圖上一條就夠了。
   */
  const seen = new Set<string>()

  for (const lane of result.lanes) {
    if (lane.role === 'down' || lane.role === 'up') continue
    if (lane.role === 'crossover' && !settings.showCrossovers) continue
    if (lane.role === 'siding' && !settings.showSidings) continue
    const prof = [...lane.profile].sort((a, b) => a[0] - b[0])
    if (prof.length < 2) continue
    const tag = `${lane.role === 'crossover' ? 'X' : 'SD'}-${lane.key.replace(':', '_')}`

    const realLatAt = (s: number) => {
      let best = prof[0]!
      for (const p of prof) if (Math.abs(p[0] - s) < Math.abs(best[0] - s)) best = p
      return best[1]
    }

    const span = prof[prof.length - 1]![0] - prof[0]![0]
    const runs = laneRuns(lane, Math.min(12, span / 3), levelOf)
    if (!runs.length) continue

    const sig = `${Math.round(prof[0]![0] / 10)}:${Math.round(prof[prof.length - 1]![0] / 10)}:${runs
      .map((r) => r.level)
      .join(',')}`
    if (seen.has(sig)) continue
    seen.add(sig)

    /*
     * 換股道那一段由斜接軌道佔住，兩側的區段各自讓出一半。
     *
     * 長度取「實際換股用掉的里程」與「橫移量」的較大者：橫向放大 9 倍之後，20 公尺
     * 內換三股會橫移 90 公尺，照實畫是一根幾乎垂直、穿過上下行的尖刺；撐開之後最陡
     * 就是 45 度。撐開後不可以跨進彎道，因為斜接軌道是一段直的平行四邊形——兩端一個
     * 落在直線、一個落在弧上，中間那條直線會橫切過整個轉角。
     */
    const halves = runs.map(() => ({ before: 0, after: 0 }))
    const tapers: Array<{ sA: number; sB: number; i: number }> = []
    for (let i = 0; i + 1 < runs.length; i += 1) {
      const a = runs[i]!
      const b = runs[i + 1]!
      const sc = (a.sTo + b.sFrom) / 2
      const host = placed.find((q) => q.kind === 'straight' && sc >= q.sFrom && sc <= q.sTo)
      if (!host) continue
      const latDelta = Math.abs(latOfLevel(a.level) - latOfLevel(b.level)) * lt
      let half = Math.max(b.sFrom - a.sTo, latDelta) / 2
      half = Math.min(half, sc - host.sFrom, host.sTo - sc)
      if (half * 2 < bandW * 0.4) continue
      halves[i]!.after = Math.max(0, sc - half - a.sTo) + (a.sTo - (sc - half))
      halves[i + 1]!.before = sc + half - b.sFrom
      tapers.push({ sA: sc - half, sB: sc + half, i })
    }

    runs.forEach((run, i) => {
      const from = run.sFrom + Math.max(0, halves[i]!.before)
      const to = run.sTo - Math.max(0, halves[i]!.after)
      if (to - from <= 1e-6) return
      emitRun(
        runs.length > 1 ? `${tag}.${i + 1}` : tag,
        lane.role,
        run.level,
        from,
        to,
        realLatAt,
        null,
        null,
      )
    })

    for (const t of tapers) {
      addTaper(
        `${tag}.T${t.i + 1}`,
        lane.role,
        t.sA,
        latOfLevel(runs[t.i]!.level),
        t.sB,
        latOfLevel(runs[t.i + 1]!.level),
        realLatAt(t.sA),
        realLatAt(t.sB),
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
