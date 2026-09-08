import {
  fitTaperAt,
  type LayoutShape,
  type TrackGenLayout,
  type Vec2,
} from './trackGenLayout'
import type { TaperTrackGeometry } from './trackShapes'

/**
 * 一塊一塊微調長度。
 *
 * 生成出來的比例尺是全圖一致的，但現場要看的不一定是比例：使用者要讓上行的某一塊跟
 * 下行的某一塊對齊，好在圖上一眼比對兩條線。這件事沒有辦法用參數表達，只能讓他自己
 * 拖——拖的是<strong>一端</strong>，不是整塊縮放。
 *
 * <h3>拖了之後別人怎麼辦</h3>
 * 同一條線上、被拖的那一端後面的每一塊<strong>整塊平移</strong>，所以不會斷開；平移
 * 到路口就停下來，由路口前面那一塊把差額吸收掉。路口本身不動——它連著別條線，動了就
 * 把整張圖拖歪。這樣整條線的頭尾位置不變，只有內部的分配改變。
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

/** 可以拖的只有一般軌道與斜接：它們是一段直的帶子，改長度不改別的 */
export function canNudge(s: LayoutShape): boolean {
  return s.kind === 'rect' || s.kind === 'taper'
}

function shifted(s: LayoutShape, d: number, axis: Axis): LayoutShape {
  const dx = axis === 'x' ? d : 0
  const dy = axis === 'x' ? 0 : d
  const samples = s.samples.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  // 真實路徑是現場座標，不跟著版面走
  if (s.kind === 'rect') {
    return { ...s, samples, centre: { x: s.centre.x + dx, y: s.centre.y + dy } }
  }
  return { ...s, samples, box: { ...s.box, xM: s.box.xM + dx, yM: s.box.yM + dy } }
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
  bandW: number,
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
    const g = s.geometry as TaperTrackGeometry
    const fit = fitTaperAt(samples[0]!, samples[samples.length - 1]!, bandW, g.entryDeg)
    if (!fit) return null
    return { ...s, samples, geometry: fit.geometry, box: fit.box }
  }
  return null
}

/** 帶子有多粗：版面上任何一塊直軌的寬度就是軌道寬度 */
function bandWidthOf(shapes: LayoutShape[]): number {
  for (const s of shapes) if (s.kind === 'rect') return s.widthM
  return 8
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
 * 一次微調：被拖的那一塊改長度，接在後面的<strong>一塊接一塊</strong>整塊平移。
 *
 * 往外走是照端點碰在一起找下一塊，不是照 road 或車道編號——一條 road 走完接下一條，
 * 編號不同但畫面上就是連著的，照編號找會在交界處留一個洞。
 *
 * 走到路口就停：路口連著別條線，動了整張圖會歪。停下來時由最後那一塊把差額縮回去，
 * 整條線的頭尾位置因此不變，只有內部的分配改變。走到底都沒有路口（盡頭那種）就整段
 * 往外長，那是使用者要的。
 */
function nudgeOnce(
  shapes: LayoutShape[],
  n: TrackGenNudge,
  bandW: number,
): LayoutShape[] | null {
  const s = shapes.find((x) => x.name === n.name)
  if (!s || !canNudge(s)) return null
  const axis = axisOf(s)
  const grown = resized(s, n.end, n.dPx, axis, bandW)
  if (!grown) return null

  const { lo, hi } = extentOf(s, axis)
  const [p0, p1] = endPointsOf(s)
  const coordOf = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  // 被拖的那一端在圖面上是哪一個點
  const target = n.end === 'lo' ? lo : hi
  let cursor = Math.abs(coordOf(p0) - target) <= Math.abs(coordOf(p1) - target) ? p0 : p1

  const next = new Map<string, LayoutShape>([[s.name, grown]])
  const seen = new Set<string>([s.name])
  let last: LayoutShape | null = null
  let hitPin = false
  for (let guard = 0; guard < shapes.length; guard += 1) {
    const cur = cursor
    const x = shapes.find((y) => !seen.has(y.name) && endPointsOf(y).some((q) => near(q, cur)))
    if (!x) break
    seen.add(x.name)
    if (isPinned(x)) {
      hitPin = true
      break
    }
    last = x
    next.set(x.name, shifted(x, n.dPx, axis))
    const [q0, q1] = endPointsOf(x)
    cursor = near(q0, cur) ? q1 : q0
  }
  if (hitPin) {
    /*
     * 後面接著路口：最後那一塊把差額縮回去，整條線的頭尾位置就不變，路口也不必動。
     * 被拖的那一塊自己就貼著路口時沒有人能吸收，這一筆就不做——動了會疊到路口上。
     */
    if (!last) return null
    const moved = next.get(last.name)!
    const la = axisOf(moved)
    if (la !== axis) return null
    // 縮的是它朝著路口那一端：平移之後那一端落在原來的位置加上位移
    const want = (axis === 'x' ? cursor.x : cursor.y) + n.dPx
    const ex = extentOf(moved, la)
    const end: NudgeEnd = Math.abs(ex.lo - want) <= Math.abs(ex.hi - want) ? 'lo' : 'hi'
    const back = resized(moved, end, -n.dPx, la, bandW)
    if (!back) return null
    next.set(last.name, back)
  }
  return shapes.map((x) => next.get(x.name) ?? x)
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

/** 重新量外框：拖過的塊會超出原本的範圍 */
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
  const bandW = bandWidthOf(layout.shapes)
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
    const next = nudgeOnce(shapes, n, bandW)
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
    bounds: applied ? boundsOf(shapes) : layout.bounds,
    nudgesApplied: applied,
    nudgeErrors: errors,
    nudgeTotalM: Number(total.toFixed(1)),
    nudgeMaxM: Number(max.toFixed(1)),
  }
}

/**
 * 拖的時候可以吸附到哪些位置。
 *
 * 用意是讓上行的某一塊跟下行的某一塊對齊：先調下面再調上面，或是反過來，都要對得上。
 * 所以候選是<strong>其他線</strong>在同一軸上的每一個塊界，加上這一塊自己原本的位置
 * ——那是「調回去」的那條線。
 */
export function snapTargetsFor(
  shapes: LayoutShape[],
  target: LayoutShape,
  axis: Axis,
): number[] {
  const out = new Set<number>()
  for (const s of shapes) {
    if (axisOf(s) !== axis) continue
    if (s.lineKey === target.lineKey) continue
    const { lo, hi } = extentOf(s, axis)
    out.add(Number(lo.toFixed(2)))
    out.add(Number(hi.toFixed(2)))
  }
  return [...out].sort((a, b) => a - b)
}
