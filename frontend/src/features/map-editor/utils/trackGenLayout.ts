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
    realLatFromM: number,
    realLatToM = realLatFromM,
  ) => {
    const rect: LayoutRect = {
      kind: 'rect',
      name,
      role,
      realLatFromM,
      realLatToM,
      samples: [p0, p1],
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
        addRect(
          name,
          role,
          placePoint(b.sFrom, lat, placed, lt),
          placePoint(b.sTo, lat, placed, lt),
          b.sFrom,
          b.sTo,
          lat,
        )
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
      const arcSamples: Vec2[] = []
      for (let i = 0; i <= 12; i += 1) {
        arcSamples.push(placePoint(b.sFrom + ((b.sTo - b.sFrom) * i) / 12, lat, placed, lt))
      }
      shapes.push({
        kind: 'corner',
        name,
        role,
        realLatFromM: lat,
        realLatToM: lat,
        samples: arcSamples,
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

  /*
   * 側線實際畫出來的股道與里程。
   *
   * 渡線是通往側線的；側線若整段落在彎道上而被裁掉，那條渡線就會指向一個不存在
   * 的東西、孤零零地戳在圖面外面——實測 SD-5 被裁光之後，X-14 與 X-15 就變成兩片
   * 橫在轉角旁邊的尖角。所以先把側線畫完、記下涵蓋範圍，渡線再依此決定畫不畫。
   */
  const sidingCoverage: Array<{ level: number; sFrom: number; sTo: number }> = []

  const sideLanes = result.lanes.filter(
    (l) => l.role === 'siding' || l.role === 'crossover',
  )
  for (const lane of [
    ...sideLanes.filter((l) => l.role === 'siding'),
    ...sideLanes.filter((l) => l.role === 'crossover'),
  ]) {
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
      /*
       * 沿線長度至少撐到跟橫移量一樣（最陡 45 度）。
       *
       * 橫向放大 9 倍之後，20 公尺內換三股道會橫移 90 公尺——照實畫是一根幾乎
       * 垂直、穿過上下行的尖刺。簡圖上渡線該是一條看得出來的斜線，所以以里程
       * 中點為中心把兩端撐開。
       */
      const latDeltaM = Math.abs(latOfLevel(la) - latOfLevel(lb)) * lt
      const sMid = (a[0] + b[0]) / 2
      let half = Math.max(Math.abs(b[0] - a[0]), latDeltaM) / 2
      /*
       * 撐開之後不可以跨進彎道。
       *
       * 斜接軌道是一段直的平行四邊形；兩端一旦一個落在直線段、一個落在弧上，中間
       * 那條直線就會橫切過整個轉角——實測 X-15 被撐到 1146–1209，而直線段 1193 就
       * 結束，畫出來是一根刺穿轉角的尖角。所以先夾回中點所在的那一段直線裡。
       */
      const host = placed.find(
        (q) => q.kind === 'straight' && sMid >= q.sFrom && sMid <= q.sTo,
      )
      if (host) {
        half = Math.min(half, sMid - host.sFrom, host.sTo - sMid)
      }
      const sA = sMid - half
      const sB = sMid + half
      // 夾完太短就不畫：比自己的帶寬還短的斜帶只是一小塊斜方塊，看不出是渡線
      if (sB - sA < bandW * 0.4) continue
      // 通往側線的渡線，目的股道要真的有畫出側線才畫
      const needsSiding = [la, lb].filter((v) => v !== 0 && v !== 1)
      const reachable = needsSiding.every((level) =>
        sidingCoverage.some(
          (c) => c.level === level && c.sTo >= sA - bandW && c.sFrom <= sB + bandW,
        ),
      )
      if (!reachable) continue

      const pa = placePoint(sA, latOfLevel(la), placed, lt)
      const pb = placePoint(sB, latOfLevel(lb), placed, lt)
      if (la === lb) {
        addRect(tag, lane.role, pa, pb, sA, sB, a[1], b[1])
      } else {
        const { geometry, box } = fitTaper(pa, pb, bandW)
        shapes.push({
          kind: 'taper',
          name: tag,
          role: lane.role,
          realLatFromM: a[1],
          realLatToM: b[1],
          samples: [pa, pb],
          geometry,
          box,
          sFrom: sA,
          sTo: sB,
        })
        pts.push({ x: box.xM, y: box.yM }, { x: box.xM + box.wM, y: box.yM + box.hM })
      }
      continue
    }

    // 側線：整條一股，只畫在直線段上
    const lat = latOfLevel(levelOfLane.get(lane.key) ?? levelOf(prof[0]![1]))
    // 真實橫向偏移照剖面查，不能用吸過股道的那個值
    const realLatAt = (s: number) => {
      let best = prof[0]!
      for (const p of prof) if (Math.abs(p[0] - s) < Math.abs(best[0] - s)) best = p
      return best[1]
    }
    const spans = straightSpans(placed, prof[0]![0], prof[prof.length - 1]![0])
    /*
     * 太短的殘段不畫。
     *
     * 側線只畫在直線脊線段上，落在轉角那一段會被裁掉；剩下幾公尺的殘段比自己的
     * 帶寬還短，畫出來是一個與任何東西都不相連的小方塊——實測 SD-5 只剩 6 與 8
     * 公尺，浮在轉角外面。寧可不畫。
     */
    const drawn = spans.filter(([a, b]) => b - a >= bandW * 0.6)
    const level = levelOfLane.get(lane.key) ?? levelOf(prof[0]![1])
    drawn.forEach(([a, b]) => sidingCoverage.push({ level, sFrom: a, sTo: b }))
    drawn.forEach(([a, b], i) => {
      addRect(
        drawn.length > 1 ? `${tag}.${i + 1}` : tag,
        lane.role,
        placePoint(a, lat, placed, lt),
        placePoint(b, lat, placed, lt),
        a,
        b,
        realLatAt(a),
        realLatAt(b),
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
