import {
  type LayoutShape,
  type TrackGenLayout,
  type Vec2,
} from './trackGenLayout'
import {
  junctionMouthJoint,
  junctionMouthsOf,
  resizeJunctionMouth,
  type JunctionMouth,
} from './trackGenNudgeJunction'

export type { JunctionMouth } from './trackGenNudgeJunction'
export {
  junctionMouthsOf,
  junctionMouthSeg,
  mouthAxis,
  SWITCH_MOUTHS,
  CROSS_MOUTHS,
} from './trackGenNudgeJunction'

/**
 * 一塊一塊微調長度。
 *
 * 生成出來的比例尺是全圖一致的，但現場要看的不一定是比例：使用者要讓上行的某一塊跟
 * 下行的某一塊對齊，好在圖上一眼比對兩條線。這件事沒有辦法用參數表達，只能讓他自己
 * 拖——拖的是<strong>一端</strong>，不是整塊縮放。
 *
 * <h3>拖了之後別人怎麼辦</h3>
 * 拖的是<strong>兩塊之間的那一條界線</strong>：A 的右邊往左拉，A 就短一截，右邊那一塊
 * <strong>一起被拖走</strong>，兩塊永遠黏著。受影響的就這一塊，其餘一個都不動。
 *
 * 斜接也可以拖，也可以當鄰居跟著伸縮。<strong>坡度會跟著變</strong>：斜接的長度本來
 * 就是它的坡，拉長就是把坡放緩。變緩之後端面仍然垂直、帶寬也不變，但帶子可能壓到旁邊
 * 那條軌道上——這是使用者選的取捨，不另外處理。
 *
 * 分岔與交叉可以<strong>逐口分開</strong>拉（主線／岔線、交叉上下行互不綁死）。
 * 口縮短時，旁邊接上的軌道（直軌／斜接／另一個路口口）要<strong>跟著變長補上</strong>，
 * 跟直軌對直軌的微調同一套「界線兩邊黏著」；口拉長則旁邊變短。圓角也可以當鄰居跟著補。
 *
 * <h3>里程不用重新對</h3>
 * 每一塊代表的里程沒有變，變的只有它畫多長。定位是「在真實路徑上走了幾成，就在圖面
 * 路徑上走幾成」，圖面路徑跟著塊一起變長變短，所以車輛的位置自動跟著調整，不需要再
 * 按一次同步。要付的代價是<strong>比例尺</strong>：那一塊畫得比它該有的長度多或少，
 * 差多少公尺算得出來，逐塊列給使用者看。
 */

export type NudgeEnd = 'lo' | 'hi'

export type TrackGenNudge = {
  /** 被拖的那一塊 */
  name: string
  /** 拖的是座標小的那一端還是大的那一端（直軌／斜接）；路口有 mouth 時仍填，僅作相容 */
  end: NudgeEnd
  /** 沿著行進軸移動多少（版面像素，正值往座標大的方向） */
  dPx: number
  /**
   * 分岔／交叉的哪一個口。
   * a/m/b＝進口／主線／岔線；lt/lb/rt/rb＝交叉四口（上＝lt/rt、下＝lb/rb）。
   */
  mouth?: JunctionMouth
}

const JUNCTION_MOUTHS = new Set<string>([
  'a',
  'm',
  'b',
  'lt',
  'lb',
  'rt',
  'rb',
  'cornerA',
  'cornerB',
])

/** 微調存在高精地圖元件的參數裡，重新生成時沿用 */
export const TRACKGEN_NUDGES_KEY = 'trackGenNudges'

export function getTrackGenNudges(
  parameters: Record<string, unknown> | undefined,
): TrackGenNudge[] {
  const raw = parameters?.[TRACKGEN_NUDGES_KEY]
  if (!Array.isArray(raw)) return []
  const out: TrackGenNudge[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Partial<TrackGenNudge>
    if (typeof o.name !== 'string' || !o.name) continue
    if (typeof o.dPx !== 'number' || !Number.isFinite(o.dPx) || o.dPx === 0) continue
    const mouth =
      typeof o.mouth === 'string' && JUNCTION_MOUTHS.has(o.mouth)
        ? (o.mouth as JunctionMouth)
        : undefined
    const end = o.end === 'lo' || o.end === 'hi' ? o.end : mouth ? 'hi' : null
    if (!end) continue
    out.push(mouth ? { name: o.name, end, dPx: o.dPx, mouth } : { name: o.name, end, dPx: o.dPx })
  }
  return out
}

export type Axis = 'x' | 'y'

/** 這一塊沿哪一軸走：橫的拖左右，縱的拖上下 */
export function axisOf(s: LayoutShape): Axis {
  const a = s.samples[0]
  const b = s.samples[s.samples.length - 1]
  if (!a || !b) return 'x'
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y'
}

/** 這一塊在那一軸上從哪到哪 */
export function extentOf(s: LayoutShape, axis: Axis): { lo: number; hi: number } {
  const vals = s.samples.map((p) => (axis === 'x' ? p.x : p.y))
  return { lo: Math.min(...vals), hi: Math.max(...vals) }
}

/** 已無「整塊鎖死」的路口；保留函式以免舊呼叫端報錯 */
export function isPinned(_s: LayoutShape): boolean {
  return false
}

/**
 * 一般軌道、斜接、分岔、交叉、圓角都可以改長度。
 *
 * 分岔／交叉／圓角是逐口拉；圓角的 bulge（曲率形狀）保持不變。
 */
export function canNudge(s: LayoutShape): boolean {
  return (
    s.kind === 'rect' ||
    s.kind === 'taper' ||
    s.kind === 'switch' ||
    s.kind === 'cross' ||
    s.kind === 'corner'
  )
}

/**
 * 改一端的位置，另一端不動。
 *
 * 一般軌道就是重算中心與長度；斜接要重新解一次形狀，因為它的坡是由兩端決定的。
 */
function resized(
  s: LayoutShape,
  end: NudgeEnd,
  d: number,
  axis: Axis,
): LayoutShape | null {
  const { lo, hi } = extentOf(s, axis)
  const nextLo = end === 'lo' ? lo + d : lo
  const nextHi = end === 'hi' ? hi + d : hi
  if (nextHi - nextLo < 1) return null
  const map = (p: Vec2): Vec2 => {
    const v = axis === 'x' ? p.x : p.y
    // 端點照新的位置擺，中間的取樣點按比例跟著挪
    const t = hi - lo > 1e-6 ? (v - lo) / (hi - lo) : 0
    const nv = nextLo + t * (nextHi - nextLo)
    return axis === 'x' ? { x: nv, y: p.y } : { x: p.x, y: nv }
  }
  const samples = s.samples.map(map)
  if (s.kind === 'rect') {
    const a = samples[0]!
    const b = samples[samples.length - 1]!
    return {
      ...s,
      samples,
      centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      lengthM: Math.hypot(b.x - a.x, b.y - a.y),
      rotationDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    }
  }
  if (s.kind === 'taper') {
    /*
     * 斜接<strong>直接把外框沿軸拉開</strong>，不重新解一次形狀。
     *
     * 重解回的是「最接近」的方框，兩端不保證落在要求的位置——把手畫的是取樣點、帶子
     * 畫的是方框，兩者於是對不上。斜接的幾何本來就是外框的比例（端面高度、坡的起訖
     * 都是比例），拉外框等於等比拉整條帶子，端面仍垂直、帶寬不變，而且完全精確。
     * 坡會跟著變緩，那正是「調整斜接長度」的意思。
     */
    const b = s.box
    const box =
      axis === 'x'
        ? { ...b, xM: nextLo, wM: nextHi - nextLo }
        : { ...b, yM: nextLo, hM: nextHi - nextLo }
    return { ...s, samples, box }
  }
  return null
}

/** 這一塊用來「碰得到鄰居」的端點（圖面座標） */
function endPointsOf(s: LayoutShape): Vec2[] {
  if (s.kind === 'switch' || s.kind === 'cross' || s.kind === 'corner') {
    return junctionMouthsOf(s).map((m) => ({
      x: (m.seg[0].x + m.seg[1].x) / 2,
      y: (m.seg[0].y + m.seg[1].y) / 2,
    }))
  }
  return [s.samples[0]!, s.samples[s.samples.length - 1]!]
}

/**
 * 兩點算「還黏著」：緊貼用較嚴；找分岔／交叉鄰居時用 {@link ATTACH_ALONG_PX}
 * 把已經拉開的縫再接回來。
 */
const TOUCH_PX = 4

/** 沿行進軸：口與直軌端點相隔不超過此距離就仍視為同一條界線（可補縫） */
const ATTACH_ALONG_PX = 120

/** 垂直於行進軸：必須同一股，否則會誤黏到隔壁車道 */
const ATTACH_PERP_PX = 16

function near(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= TOUCH_PX
}

function midOf(seg: readonly [Vec2, Vec2]): Vec2 {
  return { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
}

/** 一塊至少要留這麼長，不然它在圖上就不是一段軌道了 */
const MIN_LEN_PX = 6

/**
 * 這個界線點對應哪一個路口的哪一口。
 *
 * 不只看「幾乎重合」：同股、沿軸還在 {@link ATTACH_ALONG_PX} 內就認——先前若已拉開一截，
 * 下一次拖要把縫補上，不能當成沒鄰居。
 */
function junctionMouthAtJoint(
  shapes: LayoutShape[],
  selfName: string,
  joint: Vec2,
  axis: Axis,
): { shape: LayoutShape; mouth: JunctionMouth; mouthMid: Vec2 } | null {
  let best: { shape: LayoutShape; mouth: JunctionMouth; mouthMid: Vec2; along: number } | null =
    null
  for (const x of shapes) {
    if (x.name === selfName) continue
    if (x.kind !== 'switch' && x.kind !== 'cross' && x.kind !== 'corner') continue
    for (const m of junctionMouthsOf(x)) {
      // 口的行進軸要跟被拖那一塊一致，否則是橫貼的另一側
      if (m.axis !== axis) continue
      const mouthMid = midOf(m.seg)
      const along =
        axis === 'x' ? Math.abs(mouthMid.x - joint.x) : Math.abs(mouthMid.y - joint.y)
      const perp =
        axis === 'x' ? Math.abs(mouthMid.y - joint.y) : Math.abs(mouthMid.x - joint.x)
      if (perp > ATTACH_PERP_PX || along > ATTACH_ALONG_PX) continue
      if (!best || along < best.along) {
        best = { shape: x, mouth: m.mouth, mouthMid, along }
      }
    }
  }
  return best ? { shape: best.shape, mouth: best.mouth, mouthMid: best.mouthMid } : null
}

/** 黏在這個口上的直軌／斜接（可跨一小段縫） */
function ribbonAtMouth(
  shapes: LayoutShape[],
  selfName: string,
  joint: Vec2,
  axis: Axis,
): { shape: LayoutShape; end: NudgeEnd; endPt: Vec2 } | null {
  let best: { shape: LayoutShape; end: NudgeEnd; endPt: Vec2; along: number } | null = null
  const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  for (const x of shapes) {
    if (x.name === selfName) continue
    if (x.kind !== 'rect' && x.kind !== 'taper') continue
    if (axisOf(x) !== axis) continue
    const ex = extentOf(x, axis)
    for (const end of ['lo', 'hi'] as const) {
      const target = end === 'lo' ? ex.lo : ex.hi
      const pts = endPointsOf(x)
      const endPt =
        Math.abs(coordOf(pts[0]!) - target) <= Math.abs(coordOf(pts[pts.length - 1]!) - target)
          ? pts[0]!
          : pts[pts.length - 1]!
      const along = Math.abs(coordOf(endPt) - coordOf(joint))
      const perp =
        axis === 'x' ? Math.abs(endPt.y - joint.y) : Math.abs(endPt.x - joint.x)
      if (perp > ATTACH_PERP_PX || along > ATTACH_ALONG_PX) continue
      if (!best || along < best.along) best = { shape: x, end, endPt, along }
    }
  }
  return best ? { shape: best.shape, end: best.end, endPt: best.endPt } : null
}

/** 黏在這個口／端上、用來補長度的鄰居（直軌／斜接，或另一個路口的口） */
type FillNeighbor =
  | { kind: 'ribbon'; shape: LayoutShape; end: NudgeEnd; endPt: Vec2 }
  | { kind: 'mouth'; shape: LayoutShape; mouth: JunctionMouth; mouthMid: Vec2 }

function fillNeighborAt(
  shapes: LayoutShape[],
  selfName: string,
  joint: Vec2,
  axis: Axis,
): FillNeighbor | null {
  const ribbon = ribbonAtMouth(shapes, selfName, joint, axis)
  if (ribbon) return { kind: 'ribbon', ...ribbon }
  const junc = junctionMouthAtJoint(shapes, selfName, joint, axis)
  if (junc) return { kind: 'mouth', shape: junc.shape, mouth: junc.mouth, mouthMid: junc.mouthMid }
  return null
}

/** 把鄰居的接觸端／口移到目標行進座標（補縫＋跟界線） */
function moveFillNeighborTo(
  nb: FillNeighbor,
  targetAlong: number,
  axis: Axis,
): LayoutShape | null {
  const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  if (nb.kind === 'ribbon') {
    return resized(nb.shape, nb.end, targetAlong - coordOf(nb.endPt), axis)
  }
  return resizeJunctionMouth(nb.shape, nb.mouth, targetAlong - coordOf(nb.mouthMid))
}

/**
 * 一次微調：拖的是<strong>兩塊之間的界線</strong>，或路口的<strong>某一個口</strong>。
 *
 * 直軌／斜接：被拖那一塊伸縮多少，相鄰可調的那一塊就一起伸縮多少。
 * 分岔／交叉／圓角：只挪那一個口；旁邊不論是直軌、斜接還是別的路口口，都跟著補長度
 * （口往內縮 → 旁邊變長；口往外伸 → 旁邊變短）。主線與岔線、交叉上下行互不綁死。
 * 若中間已經有縫：先對齊再套位移，縫會在這一次拖曳補上。
 */
function nudgeOnce(shapes: LayoutShape[], n: TrackGenNudge): LayoutShape[] | null {
  const s = shapes.find((x) => x.name === n.name)
  if (!s || !canNudge(s)) return null

  if (n.mouth) {
    const joint = junctionMouthJoint(s, n.mouth)
    const grown = resizeJunctionMouth(s, n.mouth, n.dPx)
    if (!grown) return null
    if (!joint) return shapes.map((x) => (x.name === s.name ? grown : x))

    const hit = junctionMouthsOf(s).find((m) => m.mouth === n.mouth)
    const axis = hit?.axis ?? axisOf(s)
    const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
    const target = coordOf(joint) + n.dPx
    const nb = fillNeighborAt(shapes, s.name, joint, axis)
    if (!nb) return shapes.map((x) => (x.name === s.name ? grown : x))
    const moved = moveFillNeighborTo(nb, target, axis)
    if (!moved) return null
    return shapes.map((x) => {
      if (x.name === s.name) return grown
      if (x.name === nb.shape.name) return moved
      return x
    })
  }

  if (s.kind === 'switch' || s.kind === 'cross') return null

  const axis = axisOf(s)
  /*
   * <strong>照著 dPx 做，不再自己夾一次。</strong>
   *
   * 先前這裡也夾一次範圍，而拖曳中的輔助線是用按下去那一刻算出來的範圍夾的。兩個範圍
   * 只要差一點點，畫面上就是「放開之後跳到旁邊一點」——使用者指到哪，落點偏偏不在那。
   * 範圍交給拖曳那一端夾就好，這裡只擋住會讓塊短到畫不出來的極端值。
   */
  const grown = resized(s, n.end, n.dPx, axis)
  if (!grown) return null
  const d = n.dPx

  const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const joint = jointOf(s, n.end, axis)

  /*
   * 鄰居跟著改長度，界線兩邊永遠黏著：被拖那一塊短多少，鄰居就長多少，另一端留在
   * 原地。受影響的就這兩塊，其餘一個都不動。
   *
   * 盡頭沒有鄰居時只有自己伸縮。貼著分岔／交叉／圓角的口時：只動那一個口跟著移。
   * 若已分開：先把口推回界線再位移，縫一次補平。
   */
  const at = neighbourAt(shapes, s, joint)
  if (at.kind === 'shape') {
    const nb = at.shape
    const ex = extentOf(nb, axis)
    const nbEnd: NudgeEnd =
      Math.abs(ex.lo - coordOf(joint)) <= Math.abs(ex.hi - coordOf(joint)) ? 'lo' : 'hi'
    const moved = resized(nb, nbEnd, d, axis)
    if (!moved) return null
    return shapes.map((x) => {
      if (x.name === s.name) return grown
      if (x.name === nb.name) return moved
      return x
    })
  }

  const junc = junctionMouthAtJoint(shapes, s.name, joint, axis)
  if (junc) {
    const target = coordOf(joint) + d
    const movedJ =
      resizeJunctionMouth(junc.shape, junc.mouth, target - coordOf(junc.mouthMid)) ??
      (Math.abs(target - coordOf(junc.mouthMid) - d) < 1e-9
        ? null
        : resizeJunctionMouth(junc.shape, junc.mouth, d))
    if (!movedJ) return null
    return shapes.map((x) => {
      if (x.name === s.name) return grown
      if (x.name === junc.shape.name) return movedJ
      return x
    })
  }

  return shapes.map((x) => (x.name === s.name ? grown : x))
}

/** 逐塊的長度誤差（公尺）：這一塊畫得比它該有的長度多或少多少 */
export type NudgeError = {
  name: string
  /** 正值代表畫得比原本長 */
  deltaM: number
}

export type NudgeReport = {
  /** 真的做成了幾筆 */
  nudgesApplied: number
  /** 逐塊的長度誤差，只列有差的 */
  nudgeErrors: NudgeError[]
  /** 全部誤差的絕對值總和（公尺） */
  nudgeTotalM: number
  /** 單塊最大誤差（公尺） */
  nudgeMaxM: number
}

/**
 * 外框只<strong>往外長，不往內縮</strong>。
 *
 * 這裡量到的外框跟排版當初記的不會完全一樣（排版沿路記了一些額外的點），所以重量一次
 * 就算什麼都沒動也會差幾十像素。而畫面上版面座標換算成螢幕座標靠的就是外框——差這幾十
 * 像素，等於拖一下整張圖自己跳一次，游標沒動圖也在走，吸附因此永遠對不準。
 *
 * 所以拿原本的外框跟量到的取聯集：沒有跑出去就完全不變，真的往外長了才跟著長。
 */
function boundsOf(shapes: LayoutShape[]): TrackGenLayout['bounds'] {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  const note = (x: number, y: number) => {
    xMin = Math.min(xMin, x)
    yMin = Math.min(yMin, y)
    xMax = Math.max(xMax, x)
    yMax = Math.max(yMax, y)
  }
  for (const s of shapes) {
    if (s.kind === 'rect') {
      const a = Math.abs(Math.cos((s.rotationDeg * Math.PI) / 180))
      const b = Math.abs(Math.sin((s.rotationDeg * Math.PI) / 180))
      const w = (s.lengthM * a + s.widthM * b) / 2
      const h = (s.lengthM * b + s.widthM * a) / 2
      note(s.centre.x - w, s.centre.y - h)
      note(s.centre.x + w, s.centre.y + h)
    } else {
      note(s.box.xM, s.box.yM)
      note(s.box.xM + s.box.wM, s.box.yM + s.box.hM)
    }
  }
  if (!Number.isFinite(xMin)) return { xMin: 0, yMin: 0, xMax: 1, yMax: 1 }
  return { xMin, yMin, xMax, yMax }
}

function unionBounds(
  a: TrackGenLayout['bounds'],
  b: TrackGenLayout['bounds'],
): TrackGenLayout['bounds'] {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  }
}

/** 這一塊代表多少里程 */
function mileageOf(s: LayoutShape): number {
  let t = 0
  for (const sp of s.spans ?? []) t += Math.abs(sp.sToM - sp.sFromM)
  return t
}

/** 這一塊畫了多長（版面像素） */
function drawnOf(s: LayoutShape): number {
  let t = 0
  for (let i = 1; i < s.samples.length; i += 1) {
    t += Math.hypot(s.samples[i]!.x - s.samples[i - 1]!.x, s.samples[i]!.y - s.samples[i - 1]!.y)
  }
  return t
}

/**
 * 依序套用微調，並算出誤差。
 *
 * 誤差是拿<strong>原本的比例尺</strong>回推的：這一塊現在畫多長，換算成公尺是多少，
 * 跟它實際代表的里程差多少。整條線的比例尺用微調前的版面算，所以誤差講的就是「我手
 * 動改了多少」。
 */
export function applyTrackGenNudges<T extends TrackGenLayout>(
  layout: T,
  nudges: TrackGenNudge[],
): T & NudgeReport {
  /* 原本每一塊的比例尺，事後比對用 */
  const scaleOf = new Map<string, number>()
  for (const s of layout.shapes) {
    const m = mileageOf(s)
    if (m > 1e-6) scaleOf.set(s.name, drawnOf(s) / m)
  }
  const before = new Map(layout.shapes.map((s) => [s.name, drawnOf(s)]))

  let shapes = layout.shapes
  let applied = 0
  for (const n of nudges) {
    const next = nudgeOnce(shapes, n)
    if (!next) continue
    shapes = next
    applied += 1
  }

  const errors: NudgeError[] = []
  let total = 0
  let max = 0
  for (const s of shapes) {
    const scale = scaleOf.get(s.name)
    const was = before.get(s.name)
    if (!scale || scale <= 1e-9 || was === undefined) continue
    const deltaM = (drawnOf(s) - was) / scale
    if (Math.abs(deltaM) < 0.05) continue
    errors.push({ name: s.name, deltaM })
    total += Math.abs(deltaM)
    max = Math.max(max, Math.abs(deltaM))
  }
  errors.sort((a, b) => Math.abs(b.deltaM) - Math.abs(a.deltaM))

  return {
    ...layout,
    shapes,
    bounds: applied ? unionBounds(layout.bounds, boundsOf(shapes)) : layout.bounds,
    nudgesApplied: applied,
    nudgeErrors: errors,
    nudgeTotalM: Number(total.toFixed(1)),
    nudgeMaxM: Number(max.toFixed(1)),
  }
}

/**
 * 這一端接的是什麼。
 *
 * 端點碰在一起的那一塊才是能一起伸縮的鄰居。分岔／交叉／圓角在這裡回 edge，改由
 * {@link junctionMouthAtJoint} + {@link resizeJunctionMouth} 連動那一個口（避免把路口
 * 當直軌整段 resize）。
 */
function neighbourAt(
  shapes: LayoutShape[],
  s: LayoutShape,
  joint: Vec2,
): { kind: 'edge' } | { kind: 'blocked' } | { kind: 'shape'; shape: LayoutShape } {
  const touch = shapes.find(
    (x) => x.name !== s.name && endPointsOf(x).some((q) => near(q, joint)),
  )
  if (touch) {
    if (axisOf(touch) !== axisOf(s) && touch.kind !== 'switch' && touch.kind !== 'cross') {
      return { kind: 'blocked' }
    }
    if (
      !canNudge(touch) ||
      touch.kind === 'switch' ||
      touch.kind === 'cross' ||
      touch.kind === 'corner'
    ) {
      return { kind: 'edge' }
    }
    return { kind: 'shape', shape: touch }
  }
  return { kind: 'edge' }
}

/** 被拖的那一端在圖面上是哪一個點 */
function jointOf(s: LayoutShape, end: NudgeEnd, axis: Axis): Vec2 {
  const { lo, hi } = extentOf(s, axis)
  const pts = endPointsOf(s)
  const p0 = pts[0]!
  const p1 = pts[pts.length - 1]!
  const co = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const target = end === 'lo' ? lo : hi
  return Math.abs(co(p0) - target) <= Math.abs(co(p1) - target) ? p0 : p1
}

/**
 * 這一端可以拖到哪個範圍（版面座標）。
 *
 * 兩塊都至少要留一點長度，所以上下限由自己的另一端與鄰居的另一端夾出來。
 * 分岔／交叉請用 {@link mouthNudgeRangeFor}。
 */
export function nudgeRangeFor(
  shapes: LayoutShape[],
  s: LayoutShape,
  end: NudgeEnd,
): { min: number; max: number } | null {
  if (!canNudge(s)) return null
  if (s.kind === 'switch' || s.kind === 'cross') return null
  if (s.kind === 'corner') return null
  const axis = axisOf(s)
  const { lo, hi } = extentOf(s, axis)
  const joint = jointOf(s, end, axis)
  const at = neighbourAt(shapes, s, joint)
  if (at.kind === 'blocked') return null
  const nb = at.kind === 'shape' ? at.shape : null
  let min = end === 'hi' ? lo + MIN_LEN_PX : -Infinity
  let max = end === 'lo' ? hi - MIN_LEN_PX : Infinity
  if (nb) {
    const ex = extentOf(nb, axis)
    // 鄰居的另一端：界線不能越過它，還要幫它留一點長度
    const far =
      Math.abs(ex.lo - (axis === 'x' ? joint.x : joint.y)) <=
      Math.abs(ex.hi - (axis === 'x' ? joint.x : joint.y))
        ? ex.hi
        : ex.lo
    if (end === 'hi') max = Math.min(max, far - MIN_LEN_PX)
    else min = Math.max(min, far + MIN_LEN_PX)
  }
  if (!(max > min)) return null
  return { min, max }
}

/**
 * 分岔／交叉某一個口可以拖到哪個範圍。
 *
 * 細的最短長度由套用時的解幾何擋住；這裡給一個寬一點的可拖區間，並若旁邊是直軌
 * 就夾在鄰居另一端之內。
 */
export function mouthNudgeRangeFor(
  shapes: LayoutShape[],
  s: LayoutShape,
  mouth: JunctionMouth,
): { min: number; max: number; axis: Axis; from: number } | null {
  if (s.kind !== 'switch' && s.kind !== 'cross' && s.kind !== 'corner') return null
  const hit = junctionMouthsOf(s).find((m) => m.mouth === mouth)
  if (!hit) return null
  const { axis, at: from, seg } = hit
  const joint = midOf(seg)
  let min = from - 8000
  let max = from + 8000
  // 找黏在這個口上的直軌／斜接（含尚可補回的縫）
  const touch = ribbonAtMouth(shapes, s.name, joint, axis)
  if (touch) {
    const ex = extentOf(touch.shape, axis)
    const far = touch.end === 'lo' ? ex.hi : ex.lo
    // 口往鄰居另一端的方向不能越過
    if (far >= from) max = Math.min(max, far - MIN_LEN_PX)
    else min = Math.max(min, far + MIN_LEN_PX)
  }
  if (!(max > min)) return null
  return { min, max, axis, from }
}

/**
 * 拖的時候可以吸附／對準到哪些位置。
 *
 * 只收<strong>鄰近的線</strong>：對齊要對的是上下並排的那幾條，不是圖另一頭的對向。
 * 垂直距離超過幾個帶寬的直接不算。
 *
 * <code>foreignLinesOnly</code>：只收<strong>別條線</strong>的塊界。同一條線上的刀口又密又
 * 多，拿來吸附會一路黏住拖不動；畫參考線時仍可收同線，磁吸只對上下軌道。
 */
const SNAP_ROWS = 4

export function snapTargetsFor(
  shapes: LayoutShape[],
  target: LayoutShape,
  axis: Axis,
  opts?: { foreignLinesOnly?: boolean },
): number[] {
  const bandW = (() => {
    for (const s of shapes) if (s.kind === 'rect') return s.widthM
    for (const s of shapes) {
      if (s.kind === 'taper') return Math.min(s.box.wM, s.box.hM)
    }
    return 8
  })()
  const perpOf = (s: LayoutShape) => {
    const v = s.samples.map((p) => (axis === 'x' ? p.y : p.x))
    return v.reduce((t, x) => t + x, 0) / Math.max(1, v.length)
  }
  const home = perpOf(target)
  const reach = Math.max(1, bandW) * SNAP_ROWS
  const foreignOnly = opts?.foreignLinesOnly === true
  const out = new Set<number>()
  for (const s of shapes) {
    if (s.name === target.name) continue
    if (axisOf(s) !== axis) continue
    if (foreignOnly && s.lineKey === target.lineKey) continue
    if (Math.abs(perpOf(s) - home) > reach) continue
    const { lo, hi } = extentOf(s, axis)
    out.add(Number(lo.toFixed(2)))
    out.add(Number(hi.toFixed(2)))
  }
  return [...out].sort((a, b) => a - b)
}
