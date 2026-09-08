import { buildCrossFromEndSegments } from './crossJoin'
import {
  fitSwitchAt,
  fitTaperAt,
  type LayoutRect,
  type LayoutShape,
  type TrackGenLayout,
  type TrackSpan,
  type Vec2,
} from './trackGenLayout'
import {
  crossTrackEndSegmentsPx,
  switchTrackEndSegmentsPx,
  type CrossHandleKey,
  type CrossTrackGeometry,
  type SwitchTrackGeometry,
  type TaperTrackGeometry,
} from './trackShapes'

/**
 * 使用者自己決定哪兩塊要併成一塊。
 *
 * 演算法怎麼切都會有人不滿意：同一條路上，有人要的是等長的塊，有人要的是照月台、
 * 照號誌切。與其一直調參數，不如把最後一步交給使用者——他在預覽上點兩塊，說哪一塊
 * 併進哪一塊，生成就照那個結果做。
 *
 * 合併<strong>不是只把名字合起來</strong>：留下來的那一塊要長到把另一塊的位置也蓋掉，
 * 而且要把對方代表的里程一起接收，不然圖上會開一個洞，車輛走到那裡也查不到自己在
 * 哪一塊。
 */

export type TrackGenMerge = {
  /** 被併掉的那一塊（形狀名） */
  from: string
  /** 留下來的那一塊（形狀名） */
  to: string
}

/**
 * 合併存在高精地圖元件的參數裡，<strong>重新生成時沿用</strong>。
 *
 * 使用者可能點了幾十次才把整張圖併成他要的樣子；關掉對話框就忘掉的話，下次只是要調
 * 一下軌道寬度就得整批重來。
 */
export const TRACKGEN_MERGES_KEY = 'trackGenMerges'

export function getTrackGenMerges(
  parameters: Record<string, unknown> | undefined,
): TrackGenMerge[] {
  const raw = parameters?.[TRACKGEN_MERGES_KEY]
  if (!Array.isArray(raw)) return []
  const out: TrackGenMerge[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Partial<TrackGenMerge>
    if (typeof o.from !== 'string' || typeof o.to !== 'string') continue
    if (!o.from || !o.to || o.from === o.to) continue
    out.push({ from: o.from, to: o.to })
  }
  return out
}

/** 併不成的理由，講給使用者聽 */
export type TrackGenMergeRefusal =
  | 'missing'
  | 'self'
  | 'switchIntoPlain'
  | 'corner'
  | 'apart'
  | 'shape'

export type TrackGenMergeCheck =
  | { ok: true }
  | { ok: false; reason: TrackGenMergeRefusal }

/** 兩塊的里程要接得上才算相鄰（公尺） */
const JOIN_TOL_M = 1.5

const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y)

function polyLen(pts: Vec2[]): number {
  let t = 0
  for (let i = 1; i < pts.length; i += 1) t += len(pts[i - 1]!, pts[i]!)
  return t
}

/** 這一塊在圖上的兩個端點（沿行進方向的頭與尾） */
function endsOf(s: LayoutShape): [Vec2, Vec2] {
  const pts = s.samples
  return [pts[0]!, pts[pts.length - 1]!]
}

/** 這一塊代表的里程區間，一條車道一段 */
function spanRanges(s: LayoutShape) {
  return (s.spans ?? []).map((sp) => ({
    key: `${sp.roadId}:${sp.laneId}`,
    lo: Math.min(sp.sFromM, sp.sToM),
    hi: Math.max(sp.sFromM, sp.sToM),
  }))
}

/**
 * 兩塊在<strong>同一條車道上前後相接</strong>才能併。
 *
 * 用里程判斷，不用圖上的距離：並排的上下行在圖上只差一個軌道寬，位置分不開，里程
 * 卻分屬不同車道。
 */
function adjacent(a: LayoutShape, b: LayoutShape): boolean {
  const ra = spanRanges(a)
  const rb = spanRanges(b)
  return ra.some((x) =>
    rb.some(
      (y) =>
        x.key === y.key &&
        (Math.abs(x.hi - y.lo) <= JOIN_TOL_M || Math.abs(y.hi - x.lo) <= JOIN_TOL_M),
    ),
  )
}

/**
 * 這兩塊能不能併。
 *
 * <ul>
 *   <li>分岔不能併進一般軌道：併掉之後圖上就沒有東西畫出那個岔口了。
 *   <li>轉角不能當被併進去的那一方：它是一段圓弧，把別的軌道吃進來只能加大半徑，而
 *       半徑兩隻腳共用，另一隻腳會跟著被縮短——那一塊不是使用者選的。
 *   <li>兩塊要在同一條車道上前後相接。
 * </ul>
 *
 * 其餘的組合都放行。留下來的那一塊保留自己的種類，把端點伸到對方的外端，並接收對方
 * 代表的里程；併出來長什麼樣預覽上就看得到，不合意按「復原上一次」。
 */
export function canMergeTrackGen(
  shapes: LayoutShape[],
  fromName: string,
  toName: string,
): TrackGenMergeCheck {
  if (fromName === toName) return { ok: false, reason: 'self' }
  const from = shapes.find((s) => s.name === fromName)
  const to = shapes.find((s) => s.name === toName)
  if (!from || !to) return { ok: false, reason: 'missing' }
  if (from.kind === 'switch' && to.kind === 'rect') {
    return { ok: false, reason: 'switchIntoPlain' }
  }
  if (to.kind === 'corner') return { ok: false, reason: 'corner' }
  if (!adjacent(from, to)) return { ok: false, reason: 'apart' }
  return { ok: true }
}

/**
 * 反過來走：里程、路徑、方向全部跟著翻面。
 *
 * 被併掉的那一塊只有<strong>路徑與里程</strong>會留下來，它自己的幾何整塊丟掉，所以
 * 這裡不必管它是哪一種軌道。
 */
function reversed<T extends LayoutShape>(r: T): T {
  return {
    ...r,
    samples: [...r.samples].reverse(),
    realPath: r.realPath ? [...r.realPath].reverse() : undefined,
    realLatFromM: r.realLatToM,
    realLatToM: r.realLatFromM,
    /*
     * 里程與路徑比例跟著翻，<strong>行車方向不翻</strong>。
     *
     * headingRad 記的是那條車道在現場的走向，用來把走向相反的對向道篩掉；翻面的是我
     * 們畫圖的路徑順序，車子在現場往哪邊開不會因此改變。翻了的話定位會把對的那一段
     * 判成反方向而丟掉，改判到隔壁那一段——實測里程差 50 公尺。
     */
    spans: (r.spans ?? []).map((sp) => ({
      ...sp,
      sFromM: sp.sToM,
      sToM: sp.sFromM,
      pathFrom: 1 - sp.pathTo,
      pathTo: 1 - sp.pathFrom,
    })),
  }
}

/**
 * 帶子有多粗。
 *
 * 版面上每一塊直軌的寬度就是軌道寬度；被併掉的那一塊不一定是直軌，所以從整份版面取，
 * 不從當事的兩塊取。整份都沒有直軌時退回目標自己的外框短邊。
 */
function bandWidthOf(shapes: LayoutShape[], target: LayoutShape): number {
  for (const s of shapes) if (s.kind === 'rect') return s.widthM
  if (target.kind === 'rect') return target.widthM
  return Math.min(target.box.wM, target.box.hM)
}

/** 把一段里程從自己的 0–1 挪到合併後的 lo–hi */
function shiftSpans(spans: TrackSpan[] | undefined, lo: number, hi: number): TrackSpan[] {
  const k = hi - lo
  return (spans ?? []).map((sp) => ({
    ...sp,
    pathFrom: lo + sp.pathFrom * k,
    pathTo: lo + sp.pathTo * k,
  }))
}

type Joined = {
  samples: Vec2[]
  realPath: Vec2[] | undefined
  spans: TrackSpan[]
  realLatFromM: number
  realLatToM: number
  /** 併進來的那一塊接在頭還是尾 */
  atStart: boolean
  src: LayoutShape
}

/**
 * 把兩塊接成一條：路徑接起來、里程各自挪到自己那一截。
 *
 * 頭尾與方向都<strong>照真實路徑判斷</strong>，不照圖面。路口元件的圖面中心線只是它
 * 兩個口的連線，跟真實的腿不是同一條；照圖面挑會挑錯一端，車輛在那一塊上的里程就
 * 整段偏掉（實測分岔差 56 公尺）。
 *
 * 兩段真實路徑不一定接得上——分岔的路徑走的是梗到岔線，直行那一隻腿根本不在上面。
 * 所以接縫的長度也算進總長，兩邊的 f 窗各自只蓋住自己那一段，誰都不會投影到接縫上。
 */
function join(target: LayoutShape, rect: LayoutShape): Joined {
  const tr = target.realPath ?? []
  const rr = rect.realPath ?? []
  const real = tr.length >= 2 && rr.length >= 2
  const pick = (pts: Vec2[], fallback: LayoutShape): [Vec2, Vec2] =>
    real ? [pts[0]!, pts[pts.length - 1]!] : endsOf(fallback)
  const [t0, t1] = pick(tr, target)
  const [r0, r1] = pick(rr, rect)
  const atStart = Math.min(len(t0, r0), len(t0, r1)) <= Math.min(len(t1, r0), len(t1, r1))
  // 被併的那一塊要走進 target 的那一端，方向不對就整塊翻面
  const flip = atStart ? len(r1, t0) > len(r0, t0) : len(r0, t1) > len(r1, t1)
  const src = flip ? reversed(rect) : rect

  const sr = src.realPath ?? []
  const lenT = real ? polyLen(tr) : polyLen(target.samples)
  const lenS = real ? polyLen(sr) : polyLen(src.samples)
  /** 兩段路徑之間的空隙，也佔總長的一截 */
  const gap = real ? (atStart ? len(sr[sr.length - 1]!, t0) : len(t1, sr[0]!)) : 0
  const total = Math.max(1e-6, lenT + gap + lenS)

  const samples = atStart
    ? [...src.samples, ...target.samples]
    : [...target.samples, ...src.samples]
  const realPath = real
    ? atStart
      ? [...sr, ...tr]
      : [...tr, ...sr]
    : (target.realPath ?? src.realPath)
  const spans = atStart
    ? [
        ...shiftSpans(src.spans, 0, lenS / total),
        ...shiftSpans(target.spans, (lenS + gap) / total, 1),
      ]
    : [
        ...shiftSpans(target.spans, 0, lenT / total),
        ...shiftSpans(src.spans, (lenT + gap) / total, 1),
      ]

  return {
    samples,
    realPath,
    spans,
    realLatFromM: atStart ? src.realLatFromM : target.realLatFromM,
    realLatToM: atStart ? target.realLatToM : src.realLatToM,
    atStart,
    src,
  }
}

/** 併成一塊直軌：兩端就是合併後的頭尾 */
function mergeRect(target: LayoutRect, j: Joined): LayoutRect {
  const a = j.samples[0]!
  const b = j.samples[j.samples.length - 1]!
  return {
    ...target,
    samples: [a, b],
    realPath: j.realPath,
    spans: j.spans,
    realLatFromM: j.realLatFromM,
    realLatToM: j.realLatToM,
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    lengthM: len(a, b),
    rotationDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  }
}

/** 斜接吃掉一塊直軌：坡拉長，兩端重新解一次 */
function mergeTaper(
  target: LayoutShape & { kind: 'taper' },
  j: Joined,
  bandW: number,
): LayoutShape | null {
  const g = target.geometry as TaperTrackGeometry
  const a = j.samples[0]!
  const b = j.samples[j.samples.length - 1]!
  const fit = fitTaperAt(a, b, bandW, g.entryDeg)
  if (!fit) return null
  return {
    ...target,
    samples: [a, b],
    realPath: j.realPath,
    spans: j.spans,
    realLatFromM: j.realLatFromM,
    realLatToM: j.realLatToM,
    geometry: fit.geometry,
    box: fit.box,
  }
}

/** 被併掉那一塊的兩端：貼著路口的那一端與外側那一端 */
function jointOf(j: Joined): { near: Vec2; far: Vec2 } {
  const pts = j.src.samples
  const head = pts[0]!
  const tail = pts[pts.length - 1]!
  // 接在頭：被併塊走到路口，所以尾端貼著路口
  return j.atStart ? { near: tail, far: head } : { near: head, far: tail }
}

/** 幾個端面裡離這一點最近的那一個 */
function nearestKey<K extends string>(
  faces: Record<K, readonly [Vec2, Vec2]>,
  keys: readonly K[],
  p: Vec2,
): K {
  let best = keys[0]!
  let bestD = Infinity
  for (const k of keys) {
    const seg = faces[k]
    const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
    const d = len(mid, p)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

/**
 * 分岔吃掉一塊直軌：被吃的那一口往外伸長，另外兩口不動。
 *
 * 分岔的形狀由三個口的位置決定，把那一口挪到被吃那一塊的外端再解一次就好；圖上是
 * 那一隻腳變長，路口本身沒有變形。
 */
function mergeSwitch(
  target: LayoutShape & { kind: 'switch' },
  j: Joined,
  bandW: number,
): LayoutShape | null {
  const g = target.geometry as SwitchTrackGeometry
  const segs = switchTrackEndSegmentsPx(g, target.box.wM, target.box.hM)
  const off = (p: Vec2): Vec2 => ({ x: target.box.xM + p.x, y: target.box.yM + p.y })
  const world = {
    a: [off(segs.a[0]), off(segs.a[1])] as [Vec2, Vec2],
    m: [off(segs.m[0]), off(segs.m[1])] as [Vec2, Vec2],
    b: [off(segs.b[0]), off(segs.b[1])] as [Vec2, Vec2],
  }
  const { near, far } = jointOf(j)
  const key = nearestKey(world, ['a', 'm', 'b'] as const, near)
  const mid = (s: [Vec2, Vec2]): Vec2 => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 })
  const mouths = { a: mid(world.a), m: mid(world.m), b: mid(world.b) }
  const next = { ...mouths, [key]: far }
  const fit = fitSwitchAt(next.a, next.m, next.b, bandW)
  if (!fit) return null
  return {
    ...target,
    samples: j.samples,
    realPath: j.realPath,
    spans: j.spans,
    realLatFromM: j.realLatFromM,
    realLatToM: j.realLatToM,
    geometry: fit.geometry,
    box: fit.box,
  }
}

/**
 * 交叉吃掉一塊直軌：四個口各伸各的，只把被吃的那一口往外拉。
 *
 * 交叉一個元件畫兩條軌道，四個口分屬上下行。只動一個口，另一條軌道不受影響。
 */
function mergeCross(target: LayoutShape & { kind: 'cross' }, j: Joined): LayoutShape | null {
  const g = target.geometry as CrossTrackGeometry
  const segs = crossTrackEndSegmentsPx(g, target.box.wM, target.box.hM)
  const off = (p: Vec2): Vec2 => ({ x: target.box.xM + p.x, y: target.box.yM + p.y })
  const world: Record<CrossHandleKey, [Vec2, Vec2]> = {
    lt: [off(segs.lt[0]), off(segs.lt[1])],
    lb: [off(segs.lb[0]), off(segs.lb[1])],
    rt: [off(segs.rt[0]), off(segs.rt[1])],
    rb: [off(segs.rb[0]), off(segs.rb[1])],
  }
  const keys: CrossHandleKey[] = ['lt', 'lb', 'rt', 'rb']
  // 被併塊靠著路口的那一端，離哪一個口最近就是哪一口
  const { near, far } = jointOf(j)
  const key = nearestKey(world, keys, near)
  const seg = world[key]
  const d = { x: far.x - near.x, y: far.y - near.y }
  const moved: [Vec2, Vec2] = [
    { x: seg[0].x + d.x, y: seg[0].y + d.y },
    { x: seg[1].x + d.x, y: seg[1].y + d.y },
  ]
  const built = buildCrossFromEndSegments({ ...world, [key]: moved })
  if (!built) return null
  return {
    ...target,
    samples: j.samples,
    realPath: j.realPath,
    spans: j.spans,
    realLatFromM: j.realLatFromM,
    realLatToM: j.realLatToM,
    geometry: built.geometry,
    box: { xM: built.box.x, yM: built.box.y, wM: built.box.w, hM: built.box.h },
  }
}

/** 併一次：回傳新的形狀清單，併不成就回 null */
function mergeOnce(shapes: LayoutShape[], m: TrackGenMerge): LayoutShape[] | null {
  if (!canMergeTrackGen(shapes, m.from, m.to).ok) return null
  const from = shapes.find((s) => s.name === m.from)
  const to = shapes.find((s) => s.name === m.to)
  if (!from || !to) return null
  const j = join(to, from)
  const bandW = bandWidthOf(shapes, to)
  const next =
    to.kind === 'rect'
      ? mergeRect(to, j)
      : to.kind === 'taper'
        ? mergeTaper(to, j, bandW)
        : to.kind === 'switch'
          ? mergeSwitch(to, j, bandW)
          : to.kind === 'cross'
            ? mergeCross(to, j)
            : null
  if (!next) return null
  return shapes.filter((s) => s.name !== m.from).map((s) => (s.name === m.to ? next : s))
}

/** 重新量外框：併過的形狀會長大，原本的外框就不對了 */
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

/**
 * 依序套用使用者的合併。
 *
 * 順序有意義：併過一次之後名字與相鄰關係都會變，後面那一筆是使用者在<strong>已經
 * 併過</strong>的預覽上點的。所以照順序做，做不成的那一筆跳過——參數改過之後某些塊
 * 已經不在了，跳過總比整份丟掉好。
 */
export function applyTrackGenMerges(
  layout: TrackGenLayout,
  merges: TrackGenMerge[],
): TrackGenLayout & { mergesApplied: number } {
  if (!merges.length) return { ...layout, mergesApplied: 0 }
  let shapes = layout.shapes
  let applied = 0
  for (const m of merges) {
    const next = mergeOnce(shapes, m)
    if (!next) continue
    shapes = next
    applied += 1
  }
  if (!applied) return { ...layout, mergesApplied: 0 }
  return { ...layout, shapes, bounds: boundsOf(shapes), mergesApplied: applied }
}
