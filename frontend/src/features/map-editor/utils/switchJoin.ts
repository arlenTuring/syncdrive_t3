import {
  normalizeSwitchTrackGeometry,
  switchTrackEndSegmentsPx,
  type SwitchTrackGeometry,
} from './trackShapes'
import type { EndSegment } from './taperJoin'

/**
 * 由三條端面線段反推分岔軌道的外框與幾何。
 *
 * 方位用試的：四種方位各算一次，再用元件自己的端面函式驗證。三個面必須同向，兩個
 * 出口要在進口的同一側；不成立時回 null。
 */

const AXIS_EPS = 1.5
const QUARTERS = [0, 90, 180, 270] as const

type Built = {
  geometry: SwitchTrackGeometry
  box: { x: number; y: number; w: number; h: number }
}

/** 兩條線段的最大端點誤差（允許端點順序相反） */
function segError(got: EndSegment, want: EndSegment): number {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y)
  return Math.min(
    Math.max(d(got[0], want[0]), d(got[1], want[1])),
    Math.max(d(got[0], want[1]), d(got[1], want[0])),
  )
}

export function buildSwitchFromEndSegments(
  a: EndSegment,
  m: EndSegment,
  b: EndSegment,
): Built | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const vertical = flat(a, 'x') && flat(m, 'x') && flat(b, 'x')
  const horizontal = flat(a, 'y') && flat(m, 'y') && flat(b, 'y')
  if (!vertical && !horizontal) return null

  /*
   * 兩個出口要在進口的<strong>同一邊</strong>，但不必在同一條線上——兩條腿各伸各的。
   * 有一條跑到進口的另一側就不是分岔了，這個元件畫不出來。
   */
  const side = (s: EndSegment) => (vertical ? (s[0].x + s[1].x) / 2 : (s[0].y + s[1].y) / 2)
  const sideA = side(a)
  const dM = side(m) - sideA
  const dB = side(b) - sideA
  if (Math.abs(dM) <= AXIS_EPS || Math.abs(dB) <= AXIS_EPS) return null
  if (Math.sign(dM) !== Math.sign(dB)) return null

  const pts = [...a, ...m, ...b]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  if (box.w < 1 || box.h < 1) return null

  // 比例量的是「沿著面的那個方向」——面是與行進方向垂直的那條短邊
  const along = (p: { x: number; y: number }) => (vertical ? p.y : p.x)
  const span = vertical ? box.h : box.w
  const base = vertical ? box.y : box.x
  const r = (p: { x: number; y: number }) => (along(p) - base) / span
  /*
   * 沿著<strong>行進方向</strong>的比例，用來算兩條腿各伸多遠。量的是「離進口多遠」，
   * 所以不管方位怎麼轉、進口在左還在右，算出來都是 0–1。
   */
  const runSpan = vertical ? box.w : box.h
  const runAt = (p: { x: number; y: number }) => (vertical ? p.x : p.y)
  const runBase = vertical ? box.x : box.y
  const runR = (p: { x: number; y: number }) => (runAt(p) - runBase) / Math.max(1e-6, runSpan)
  const aRun = (runR(a[0]) + runR(a[1])) / 2
  const reach = (s: EndSegment) =>
    Math.max(0, Math.min(1, Math.abs((runR(s[0]) + runR(s[1])) / 2 - aRun)))
  const mAt = reach(m)
  const bAt = reach(b)

  let best: { built: Built; err: number } | null = null
  for (const entryDeg of QUARTERS) {
    for (const rev of [false, true]) {
      const rr = (p: { x: number; y: number }) => (rev ? 1 - r(p) : r(p))
      const geometry: SwitchTrackGeometry = {
        aFrom: rr(a[0]),
        aTo: rr(a[1]),
        mFrom: rr(m[0]),
        mTo: rr(m[1]),
        bFrom: rr(b[0]),
        bTo: rr(b[1]),
        mAt,
        bAt,
        entryDeg,
      }
      const segs = switchTrackEndSegmentsPx(geometry, box.w, box.h)
      const shift = (p: { x: number; y: number }) => ({ x: box.x + p.x, y: box.y + p.y })
      const got = {
        a: [shift(segs.a[0]), shift(segs.a[1])] as EndSegment,
        m: [shift(segs.m[0]), shift(segs.m[1])] as EndSegment,
        b: [shift(segs.b[0]), shift(segs.b[1])] as EndSegment,
      }
      /*
       * 兩個出口誰是直行、誰是岔出，由使用者拖的是哪一個把手決定，這裡不重排；
       * 但整體方位可能把兩者對調，所以兩種配對都算，取小的。
       */
      const err = Math.min(
        Math.max(segError(got.a, a), segError(got.m, m), segError(got.b, b)),
        Math.max(segError(got.a, a), segError(got.m, b), segError(got.b, m)),
      )
      if (!best || err < best.err) best = { built: { geometry, box }, err }
    }
  }
  if (!best || best.err > 2) return null
  return {
    geometry: normalizeSwitchTrackGeometry(best.built.geometry),
    box: best.built.box,
  }
}

/**
 * 把一個面換成目標邊之後，三個面該長什麼樣。
 */
export function alignSwitchFaces(
  cur: { a: EndSegment; m: EndSegment; b: EndSegment },
  end: 'a' | 'm' | 'b',
  target: EndSegment,
): { a: EndSegment; m: EndSegment; b: EndSegment } | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  const axis: 'x' | 'y' | null = flat(target, 'x') ? 'x' : flat(target, 'y') ? 'y' : null
  if (!axis) return null
  if (!flat(cur.a, axis) || !flat(cur.m, axis) || !flat(cur.b, axis)) return null
  /*
   * 對手邊端點順序常與本面相反；對齊到與被換那一面相同的沿面方向，
   * 避免重建後 a／m from→to 反向畫成蝴蝶。
   */
  const along = (p: { x: number; y: number }) => (axis === 'x' ? p.y : p.x)
  const face = cur[end]
  const faceDir = along(face[1]) - along(face[0])
  const targetDir = along(target[1]) - along(target[0])
  const aligned: EndSegment =
    faceDir * targetDir < 0 ? [target[1], target[0]] : target
  return { ...cur, [end]: aligned }
}
