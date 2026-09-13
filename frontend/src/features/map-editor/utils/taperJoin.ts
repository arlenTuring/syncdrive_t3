import { taperTrackEndSegmentsPx, type TaperTrackGeometry } from './trackShapes'

/**
 * 由兩條端面線段反推斜接軌道的外框與幾何。
 *
 * 方位用試的：四種方位各算一次，再用元件自己的端面函式驗證。兩個面必須同向且分居
 * 兩側；不成立時回 null。
 */
export type EndSegment = readonly [{ x: number; y: number }, { x: number; y: number }]

const AXIS_EPS = 1.5
const QUARTERS = [0, 90, 180, 270] as const

type Built = {
  geometry: TaperTrackGeometry
  box: { x: number; y: number; w: number; h: number }
}

type Pt = { x: number; y: number }

/** 兩條線段的最大端點誤差（允許端點順序相反） */
function segError(got: EndSegment, want: EndSegment): number {
  const d = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y)
  return Math.min(
    Math.max(d(got[0], want[0]), d(got[1], want[1])),
    Math.max(d(got[0], want[1]), d(got[1], want[0])),
  )
}

function flatOn(s: EndSegment, axis: 'x' | 'y'): boolean {
  return Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
}

function segLen(s: EndSegment): number {
  return Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)
}

function segMid(s: EndSegment): Pt {
  return { x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 }
}

/** 兩端面端點都沿同一方向排（沿軸遞增），aFrom↔bFrom 才不會交叉打結 */
function orientAlong(s: EndSegment, along: (p: Pt) => number): EndSegment {
  return along(s[0]) <= along(s[1]) ? s : [s[1], s[0]]
}

/** 兩邊長邊是否相交（沙漏／打結） */
function longEdgesCross(a: EndSegment, b: EndSegment): boolean {
  const orient = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y))
  const onSeg = (p: Pt, q: Pt, r: Pt) =>
    Math.min(p.x, q.x) - 1e-6 <= r.x &&
    r.x <= Math.max(p.x, q.x) + 1e-6 &&
    Math.min(p.y, q.y) - 1e-6 <= r.y &&
    r.y <= Math.max(p.y, q.y) + 1e-6
  const proper = (p1: Pt, q1: Pt, p2: Pt, q2: Pt) => {
    const o1 = orient(p1, q1, p2)
    const o2 = orient(p1, q1, q2)
    const o3 = orient(p2, q2, p1)
    const o4 = orient(p2, q2, q1)
    if (o1 !== o2 && o3 !== o4) return true
    if (o1 === 0 && onSeg(p1, q1, p2)) return true
    if (o2 === 0 && onSeg(p1, q1, q2)) return true
    if (o3 === 0 && onSeg(p2, q2, p1)) return true
    if (o4 === 0 && onSeg(p2, q2, q1)) return true
    return false
  }
  // aFrom–bFrom 與 aTo–bTo
  return proper(a[0], b[0], a[1], b[1])
}

/**
 * 接合時：被拖的那一面換成對手的邊（齊寬），對面改成與之<strong>平行</strong>。
 *
 * 斜接只能表示兩端同向的梯形／平行四邊形。對手邊是橫的、自己對面還是直的時，
 * 若不先把對面轉成同向，{@link buildTaperFromEndSegments} 會直接失敗——畫面上就像
 * 只碰到一角、寬度也對不齊（未變形接合）。
 *
 * 對面原本就同向時原樣保留（長度可與對手不同 → 梯形）。不同向時：以對面中點為心、
 * 保留原長度，投影成與對手平行的邊。兩端端點統一沿軸方向，避免打結。
 */
export function alignTaperFaces(
  cur: { a: EndSegment; b: EndSegment },
  end: 'a' | 'b',
  target: EndSegment,
): { a: EndSegment; b: EndSegment } | null {
  const axis: 'x' | 'y' | null = flatOn(target, 'x')
    ? 'x'
    : flatOn(target, 'y')
      ? 'y'
      : null
  if (!axis) return null

  const along = (p: Pt) => (axis === 'y' ? p.x : p.y)
  const otherKey = end === 'a' ? 'b' : 'a'
  const other = cur[otherKey]
  let nextOther: EndSegment
  if (flatOn(other, axis)) {
    nextOther = other
  } else {
    const mid = segMid(other)
    const half = Math.max(1, segLen(other) / 2)
    nextOther =
      axis === 'y'
        ? [
            { x: mid.x - half, y: mid.y },
            { x: mid.x + half, y: mid.y },
          ]
        : [
            { x: mid.x, y: mid.y - half },
            { x: mid.x, y: mid.y + half },
          ]
  }

  const travelOf = (s: EndSegment) =>
    axis === 'y' ? (s[0].y + s[1].y) / 2 : (s[0].x + s[1].x) / 2
  if (Math.abs(travelOf(target) - travelOf(nextOther)) < 2) return null

  const t = orientAlong(target, along)
  const o = orientAlong(nextOther, along)
  return end === 'a' ? { a: t, b: o } : { a: o, b: t }
}

export function buildTaperFromEndSegments(a: EndSegment, b: EndSegment): Built | null {
  const vertical = flatOn(a, 'x') && flatOn(b, 'x')
  const horizontal = flatOn(a, 'y') && flatOn(b, 'y')
  if (!vertical && !horizontal) return null

  const along = (p: Pt) => (vertical ? p.y : p.x)
  // 先統一兩端面的端點方向，否則 aFrom 接到 bFrom 會交叉成沙漏
  const aN = orientAlong(a, along)
  const bN = orientAlong(b, along)

  const xs = [aN[0].x, aN[1].x, bN[0].x, bN[1].x]
  const ys = [aN[0].y, aN[1].y, bN[0].y, bN[1].y]
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  if (box.w < 1 || box.h < 1) return null

  /*
   * 端面在形狀自己的座標系裡是「左緣 x=0、右緣 x=w」的垂直線段，由四個比例描述。
   * 四種方位 × 兩種配對全部算出來再驗證；長邊交叉（打結）的候選直接丟掉。
   */
  const span = vertical ? box.h : box.w
  const base = vertical ? box.y : box.x
  const r = (p: Pt) => (along(p) - base) / span

  let best: { built: Built; err: number } | null = null
  for (const entryDeg of QUARTERS) {
    for (const flip of [false, true]) {
      const left = flip ? bN : aN
      const right = flip ? aN : bN
      for (const rev of [false, true]) {
        const geometry: TaperTrackGeometry = {
          aFrom: rev ? 1 - r(left[0]) : r(left[0]),
          aTo: rev ? 1 - r(left[1]) : r(left[1]),
          bFrom: rev ? 1 - r(right[0]) : r(right[0]),
          bTo: rev ? 1 - r(right[1]) : r(right[1]),
          entryDeg,
        }
        // 同一端面 from/to 相對順序相反 → 長邊必交叉
        if ((geometry.aFrom - geometry.aTo) * (geometry.bFrom - geometry.bTo) < 0) {
          continue
        }
        const segs = taperTrackEndSegmentsPx(geometry, box.w, box.h)
        const shift = (p: Pt) => ({ x: box.x + p.x, y: box.y + p.y })
        const gotA: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
        const gotB: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
        if (longEdgesCross(gotA, gotB)) continue
        const err = Math.max(
          Math.min(
            segError(gotA, aN) + segError(gotB, bN),
            segError(gotA, bN) + segError(gotB, aN),
          ),
          0,
        )
        if (!best || err < best.err) best = { built: { geometry, box }, err }
      }
    }
  }
  if (!best || best.err > 2) return null
  return best.built
}
