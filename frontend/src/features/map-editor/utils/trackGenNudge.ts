import {
  type LayoutShape,
  type TrackGenLayout,
  type Vec2,
} from './trackGenLayout'

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
 * 兩邊都得是一般軌道才給拖。斜接與路口的長度就是它們的幾何——斜接拉長等於換一個坡度、
 * 轉角拉長等於換一個半徑——改了就不是原來那個東西；而不改長度又只能整塊平移，平移
 * 之後它的另一頭就跟後面斷開。兩條路都不行，所以貼著它們的那一端<strong>不長把手</strong>。
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
  /** 拖的是座標小的那一端還是大的那一端 */
  end: NudgeEnd
  /** 沿著那一塊自己的軸移動多少（版面像素，正值往座標大的方向） */
  dPx: number
}

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
    if (o.end !== 'lo' && o.end !== 'hi') continue
    if (typeof o.dPx !== 'number' || !Number.isFinite(o.dPx) || o.dPx === 0) continue
    out.push({ name: o.name, end: o.end, dPx: o.dPx })
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

/** 路口不給拖也不平移：它連著別條線，動了整張圖就歪了 */
export function isPinned(s: LayoutShape): boolean {
  return s.kind === 'corner' || s.kind === 'switch' || s.kind === 'cross'
}

/**
 * 只有一般軌道能改長度。
 *
 * 斜接、轉角、分岔、交叉的長度就是它們的幾何：斜接拉長坡就變緩、轉角拉長弧就變形。
 * 那不是「同一條軌道畫長一點」，是換成另一個東西。所以它們一律不動——調長度會疊到
 * 它們身上時就疊上去，寧可壓線也不要把幾何改掉。
 */
export function canNudge(s: LayoutShape): boolean {
  return s.kind === 'rect'
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
  return null
}

/** 這一塊的兩個端點（圖面座標） */
function endPointsOf(s: LayoutShape): [Vec2, Vec2] {
  return [s.samples[0]!, s.samples[s.samples.length - 1]!]
}

/** 兩點碰在一起（圖面像素）：相接的兩塊端點是同一個點 */
const TOUCH_PX = 1.5

function near(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= TOUCH_PX
}

/**
 * 一次微調：拖的是<strong>兩塊之間的界線</strong>。
 *
 * 被拖的那一塊在那一端伸縮多少，相鄰的那一塊就在對著的那一端反向伸縮多少，界線因此
 * 剛好落在同一個位置，不會開縫也不會疊到。其餘的塊完全不動。
 *
 * 相鄰的是路口就不做：路口的長度是它自己的幾何，改不得。找不到鄰居（盡頭）時只有
 * 被拖的那一塊伸縮。
 */
function nudgeOnce(shapes: LayoutShape[], n: TrackGenNudge): LayoutShape[] | null {
  const s = shapes.find((x) => x.name === n.name)
  if (!s || !canNudge(s)) return null
  const axis = axisOf(s)
  /*
   * 超出做得到的範圍時<strong>停在極限</strong>，不要整筆不做。
   *
   * 整筆不做的話畫面上是：輔助線跟著游標走，塊卻一動也不動，使用者只看得到「拖了沒
   * 反應」。停在極限至少看得出來已經到底了。
   */
  const range = nudgeRangeFor(shapes, s, n.end)
  if (!range) return null
  const { lo, hi } = extentOf(s, axis)
  const from = n.end === 'lo' ? lo : hi
  const d = Math.max(range.min, Math.min(range.max, from + n.dPx)) - from
  if (Math.abs(d) < 1e-6) return null
  const grown = resized(s, n.end, d, axis)
  if (!grown) return null

  const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const joint = jointOf(s, n.end, axis)

  /*
   * 鄰居跟著改長度，界線兩邊永遠黏著：被拖那一塊短多少，鄰居就長多少，另一端留在
   * 原地。受影響的就這兩塊，其餘一個都不動。
   *
   * 盡頭沒有鄰居時只有自己伸縮。
   */
  const at = neighbourAt(shapes, s, joint)
  const nb = at.kind === 'shape' ? at.shape : null
  if (!nb) return shapes.map((x) => (x.name === s.name ? grown : x))
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

/** 這一塊在圖上佔的方框 */
function boxOf(s: LayoutShape) {
  if (s.kind !== 'rect') {
    return { x0: s.box.xM, y0: s.box.yM, x1: s.box.xM + s.box.wM, y1: s.box.yM + s.box.hM }
  }
  const c = Math.abs(Math.cos((s.rotationDeg * Math.PI) / 180))
  const d = Math.abs(Math.sin((s.rotationDeg * Math.PI) / 180))
  const w = (s.lengthM * c + s.widthM * d) / 2
  const h = (s.lengthM * d + s.widthM * c) / 2
  return { x0: s.centre.x - w, y0: s.centre.y - h, x1: s.centre.x + w, y1: s.centre.y + h }
}

/**
 * 這一端接的是什麼。
 *
 * 端點碰在一起的那一塊才是能一起伸縮的鄰居。路口不算：交叉與分岔的圖面中心線是它整
 * 個外框的對角，不是四個口的位置，所以端點永遠對不上——只看端點的話會把路口當成盡頭，
 * 一拖就疊到路口上（實測斜接整片壓過旁邊兩塊）。所以再看一次方框：有東西罩著這個
 * 點就是路口，那一端不給拖。
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
    // 鄰居不是一般軌道就整個不給拖：它得跟著改長度才不會斷開，而改長度就是改幾何
    if (touch.kind !== 'rect' || axisOf(touch) !== axisOf(s)) return { kind: 'blocked' }
    return { kind: 'shape', shape: touch }
  }
  const pad = TOUCH_PX
  const covered = shapes.some((x) => {
    if (x.name === s.name) return false
    const b = boxOf(x)
    return (
      joint.x >= b.x0 - pad &&
      joint.x <= b.x1 + pad &&
      joint.y >= b.y0 - pad &&
      joint.y <= b.y1 + pad
    )
  })
  return covered ? { kind: 'blocked' } : { kind: 'edge' }
}

/** 一塊至少要留這麼長，不然它在圖上就不是一段軌道了 */
const MIN_LEN_PX = 6

/** 被拖的那一端在圖面上是哪一個點 */
function jointOf(s: LayoutShape, end: NudgeEnd, axis: Axis): Vec2 {
  const { lo, hi } = extentOf(s, axis)
  const [p0, p1] = endPointsOf(s)
  const co = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const target = end === 'lo' ? lo : hi
  return Math.abs(co(p0) - target) <= Math.abs(co(p1) - target) ? p0 : p1
}

/**
 * 這一端可以拖到哪個範圍（版面座標）。
 *
 * 兩塊都至少要留一點長度，所以上下限由自己的另一端與鄰居的另一端夾出來。鄰居是路口
 * 時整個不給拖——路口的長度改不得，回 null，畫面上那一端就不長把手。
 */
export function nudgeRangeFor(
  shapes: LayoutShape[],
  s: LayoutShape,
  end: NudgeEnd,
): { min: number; max: number } | null {
  if (!canNudge(s)) return null
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
    const far = Math.abs(ex.lo - (axis === 'x' ? joint.x : joint.y)) <= Math.abs(ex.hi - (axis === 'x' ? joint.x : joint.y)) ? ex.hi : ex.lo
    if (end === 'hi') max = Math.min(max, far - MIN_LEN_PX)
    else min = Math.max(min, far + MIN_LEN_PX)
  }
  if (!(max > min)) return null
  return { min, max }
}

/**
 * 拖的時候可以吸附到哪些位置。
 *
 * 只收<strong>鄰近的線</strong>：對齊要對的是上下並排的那幾條，不是圖另一頭的對向。
 * 全圖都收的話候選會多到密密麻麻，手一抖就黏到不相干的那一條。垂直距離超過幾個帶寬
 * 的直接不算。
 *
 * 被拖的那一塊自己不算，不然會黏在原地；同一條線上的其他塊界算，那是「跟自己這條線
 * 上的某一刀對齊」。
 */
const SNAP_ROWS = 3

export function snapTargetsFor(
  shapes: LayoutShape[],
  target: LayoutShape,
  axis: Axis,
): number[] {
  const bandW = (() => {
    for (const s of shapes) if (s.kind === 'rect') return s.widthM
    return 8
  })()
  const perpOf = (s: LayoutShape) => {
    const v = s.samples.map((p) => (axis === 'x' ? p.y : p.x))
    return v.reduce((t, x) => t + x, 0) / Math.max(1, v.length)
  }
  const home = perpOf(target)
  const reach = Math.max(1, bandW) * SNAP_ROWS
  const out = new Set<number>()
  for (const s of shapes) {
    if (s.name === target.name) continue
    if (axisOf(s) !== axis) continue
    if (Math.abs(perpOf(s) - home) > reach) continue
    const { lo, hi } = extentOf(s, axis)
    out.add(Number(lo.toFixed(2)))
    out.add(Number(hi.toFixed(2)))
  }
  return [...out].sort((a, b) => a - b)
}
