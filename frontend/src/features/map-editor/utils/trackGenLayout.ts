import { placePoint, placeSpine, type TrackGenSettings } from './trackGenFacility'
import type { LaneRole, ProjectedLane, TrackGenResult, Vec2 } from './trackGenerator'
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
 * <h3>為什麼要有這一層</h3>
 * 預覽與「套用到地圖」原本各自算一次位置，兩邊算法一有差異就對不起來——實際發生
 * 過：套用出來的軌道方向是反的、ㄩ 形也散掉了。現在兩邊都吃這一支的輸出，
 * 對不起來在結構上就不可能。
 *
 * <h3>方位不用推的，用試的</h3>
 * 圓角與斜接軌道的形狀由元件自己的 path 函式決定，方位只有 90 度的倍數四種。
 * 排版<strong>不自己推</strong>該轉幾度——推錯過一次，整個轉角平移了一個外框的距離，
 * 而且畫面上看起來只是「位置怪怪的」，很難聯想到是角度慣例不一致。現在改成四種
 * 都試，挑兩端最貼合目標點的那一種，排版與繪製就不可能各說各話。
 *
 * 單位是<strong>版面公尺</strong>：沿線是真實公尺，橫向乘上放大倍率。上下行只差
 * 3.5 公尺，不放大會黏成一條線。真實座標另外由 refPoints 換算，不混在這裡。
 */

export const LANE_W_M = 3.35

export type LayoutRect = {
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
export type LayoutCorner = {
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
export type LayoutTaper = {
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
  const depthRatio = Math.max(0.02, Math.min(1, bandWM / S))
  let best: {
    geometry: CornerTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null
  for (const entryDeg of QUARTERS) {
    const geometry: CornerTrackGeometry = {
      arcXRatio: 1,
      arcYRatio: 1,
      depthRatio,
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
 * 挑一個方位與位置，讓斜帶兩端落在 p0／p1 上。
 *
 * <h3>切角比例怎麼來的</h3>
 * 兩條斜邊的水平間距是 2·w·(1−t)，把它換算成垂直於斜向的寬度再令其等於帶寬，
 * 就得到 t。直接用 1−帶寬/長邊會得到兩倍寬的帶子——實測渡線畫出來是一坨方塊
 * 帶著兩個缺口，不是一條斜帶。
 *
 * <h3>位置用算的，不用猜</h3>
 * 決定方位與比例之後，兩端的位置就固定了；把方框平移到讓兩端落在目標點上即可。
 * 先前拿外接方框硬套，端點自然對不上相鄰的軌道。
 */
function fitTaper(
  p0: Vec2,
  p1: Vec2,
  bandWM: number,
): { geometry: TaperTrackGeometry; box: { xM: number; yM: number; wM: number; hM: number } } {
  const wM = Math.max(bandWM, Math.abs(p1.x - p0.x) + bandWM)
  const hM = Math.max(bandWM, Math.abs(p1.y - p0.y) + bandWM)
  let best: {
    geometry: TaperTrackGeometry
    box: { xM: number; yM: number; wM: number; hM: number }
    err: number
  } | null = null

  for (const entryDeg of QUARTERS) {
    // 轉 90 度時形狀的寬高互換，切角比例要在互換後的座標系裡算
    const swap = entryDeg % 180 !== 0
    const w = swap ? hM : wM
    const h = swap ? wM : hM
    const diag = Math.hypot(w, h)
    const cut = Math.max(0, Math.min(1, 1 - (bandWM * diag) / (2 * w * h)))
    const geometry: TaperTrackGeometry = {
      topCutRatio: cut,
      bottomCutRatio: cut,
      entryDeg,
    }
    const ends = taperTrackEndsPx(geometry, wM, hM)
    for (const [ea, eb, ta, tb] of [
      [ends.a, ends.b, p0, p1],
      [ends.a, ends.b, p1, p0],
    ] as Array<[typeof ends.a, typeof ends.b, Vec2, Vec2]>) {
      // 平移量取兩端各自需要的位移的平均，殘差就是兩者的差
      const dx = ((ta.x - ea.x) + (tb.x - eb.x)) / 2
      const dy = ((ta.y - ea.y) + (tb.y - eb.y)) / 2
      const err = Math.hypot(ta.x - ea.x - dx, ta.y - ea.y - dy) * 2
      if (!best || err < best.err) {
        best = { geometry, box: { xM: dx, yM: dy, wM, hM }, err }
      }
    }
  }
  return { geometry: best!.geometry, box: best!.box }
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
): { levelOf: (lateralM: number) => number; levelOfLane: Map<string, number> } {
  const mean = (l: ProjectedLane) =>
    l.profile.reduce((a, p) => a + p[1], 0) / Math.max(1, l.profile.length)

  const sidings = lanes.filter((l) => l.role === 'siding')
  const levelOfLane = new Map<string, number>()
  // 代表性橫向距離：主線兩條先佔 0 與 1
  const reps: Array<{ level: number; lateralM: number }> = [
    { level: 0, lateralM: 0 },
    { level: 1, lateralM: mainLateralM },
  ]

  const lo = Math.min(0, mainLateralM)
  const hi = Math.max(0, mainLateralM)
  const outer = sidings.filter((l) => mean(l) > hi).sort((a, b) => mean(a) - mean(b))
  const inner = sidings.filter((l) => mean(l) < lo).sort((a, b) => mean(b) - mean(a))
  outer.forEach((l, i) => {
    levelOfLane.set(l.key, 2 + i)
    reps.push({ level: 2 + i, lateralM: mean(l) })
  })
  inner.forEach((l, i) => {
    levelOfLane.set(l.key, -1 - i)
    reps.push({ level: -1 - i, lateralM: mean(l) })
  })

  const levelOf = (lateralM: number) => {
    let best = reps[0]!
    for (const r of reps) {
      if (Math.abs(r.lateralM - lateralM) < Math.abs(best.lateralM - lateralM)) best = r
    }
    return best.level
  }
  return { levelOf, levelOfLane }
}

/**
 * 只保留落在直線脊線段上的里程區間。
 *
 * 側線橫跨轉角時，用頭尾兩點拉一條矩形會拉出一條弦——畫面上是一根從轉角斜刺
 * 出去的棒子。轉角的側線在簡圖上不畫，比畫歪更乾淨。
 */
function straightSpans(
  placed: ReturnType<typeof placeSpine>,
  sFrom: number,
  sTo: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const seg of placed) {
    if (seg.kind !== 'straight') continue
    const a = Math.max(sFrom, seg.sFrom)
    const b = Math.min(sTo, seg.sTo)
    if (b - a > 1) out.push([a, b])
  }
  return out
}

export function layoutTrackGen(
  result: TrackGenResult,
  settings: TrackGenSettings,
): TrackGenLayout {
  const lt = settings.lateralScale
  const placed = placeSpine(result.spine, 1, settings.cornerRadiusM)
  const bandW = LANE_W_M * lt
  const shapes: LayoutShape[] = []
  const pts: Vec2[] = []

  const addRect = (
    name: string,
    role: LaneRole,
    p0: Vec2,
    p1: Vec2,
    sFrom: number,
    sTo: number,
  ) => {
    const rect: LayoutRect = {
      kind: 'rect',
      name,
      role,
      centre: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
      lengthM: Math.hypot(p1.x - p0.x, p1.y - p0.y),
      widthM: bandW,
      rotationDeg: (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI,
      sFrom,
      sTo,
    }
    if (rect.lengthM < 0.5) return
    shapes.push(rect)
    pts.push(...rectCorners(rect))
  }

  for (const b of result.blocks) {
    for (const [lat, name, role] of [
      [0, b.nameDown, 'down'],
      [b.lateralM, b.nameUp, 'up'],
    ] as Array<[number, string, LaneRole]>) {
      if (b.spineKind === 'straight') {
        addRect(name, role, placePoint(b.sFrom, lat, placed, lt), placePoint(b.sTo, lat, placed, lt), b.sFrom, b.sTo)
        continue
      }

      /*
       * 彎道：整段一段弧帶。
       *
       * 用區塊<strong>中點</strong>去找所屬脊線段：區塊里程存進結果時做過四捨五入，
       * 拿端點配 1e-6 的容差會配不到，整個彎道就不見了。
       */
      const mid = (b.sFrom + b.sTo) / 2
      const seg = placed.find((q) => q.kind === 'arc' && mid >= q.sFrom && mid <= q.sTo)
      if (!seg || seg.kind !== 'arc') continue
      const centreRadius = Math.abs(seg.radiusPx - seg.sign * lat * lt)
      const outerR = centreRadius + bandW / 2
      const p0 = placePoint(b.sFrom, lat, placed, lt)
      const p1 = placePoint(b.sTo, lat, placed, lt)
      const { geometry, box } = fitCorner(seg.centre, outerR, bandW, p0, p1)
      shapes.push({
        kind: 'corner',
        name,
        role,
        geometry,
        box,
        outerRadiusM: outerR,
        sFrom: b.sFrom,
        sTo: b.sTo,
      })
      pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
    }
  }

  /*
   * 渡線與側線。
   *
   * 照真實的橫向偏移畫，側線會飛出畫面外——真實路網的側線本來就可以岔到很遠。
   * 簡圖只表達「在第幾股」，所以先照橫向距離排序發股道號碼，再照號碼擺。
   */
  const mainLateral = result.blocks[0]?.lateralM ?? LANE_W_M
  const { levelOf, levelOfLane } = buildLaneLevels(result.lanes, mainLateral)
  const latOfLevel = (level: number) => level * mainLateral

  /*
   * 同一條渡線在 OpenDRIVE 裡有正反兩個方向的車道，投影出來是同一段里程、同一組
   * 股道。兩條都畫會疊在一起，看起來像一坨有缺口的方塊——簡圖上一條就夠了。
   */
  const seenCrossovers = new Set<string>()

  for (const lane of result.lanes) {
    if (lane.role === 'down' || lane.role === 'up') continue
    if (lane.role === 'crossover' && !settings.showCrossovers) continue
    if (lane.role === 'siding' && !settings.showSidings) continue
    const prof = [...lane.profile].sort((a, b) => a[0] - b[0])
    if (prof.length < 2) continue
    const tag = `${lane.role === 'crossover' ? 'X' : 'SD'}-${lane.key.replace(':', '_')}`

    if (lane.role === 'crossover') {
      const a = prof[0]!
      const b = prof[prof.length - 1]!
      const la = levelOf(a[1])
      const lb = levelOf(b[1])
      const sig = `${Math.round(a[0] / 10)}:${Math.round(b[0] / 10)}:${[la, lb].sort().join(',')}`
      if (seenCrossovers.has(sig)) continue
      seenCrossovers.add(sig)
      const pa = placePoint(a[0], latOfLevel(la), placed, lt)
      const pb = placePoint(b[0], latOfLevel(lb), placed, lt)
      if (la === lb) {
        addRect(tag, lane.role, pa, pb, a[0], b[0])
      } else {
        const { geometry, box } = fitTaper(pa, pb, bandW)
        shapes.push({ kind: 'taper', name: tag, role: lane.role, geometry, box, sFrom: a[0], sTo: b[0] })
        pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
      }
      continue
    }

    // 側線：整條一股，只畫在直線段上
    const lat = latOfLevel(levelOfLane.get(lane.key) ?? levelOf(prof[0]![1]))
    const spans = straightSpans(placed, prof[0]![0], prof[prof.length - 1]![0])
    spans.forEach(([a, b], i) => {
      addRect(
        spans.length > 1 ? `${tag}.${i + 1}` : tag,
        lane.role,
        placePoint(a, lat, placed, lt),
        placePoint(b, lat, placed, lt),
        a,
        b,
      )
    })
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

/** 矩形的四角（預覽用） */
export function rectPolygon(r: LayoutRect): Vec2[] {
  return rectCorners(r)
}
