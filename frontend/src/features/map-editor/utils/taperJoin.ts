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

/** 兩條線段的最大端點誤差（允許端點順序相反） */
function segError(got: EndSegment, want: EndSegment): number {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y)
  return Math.min(
    Math.max(d(got[0], want[0]), d(got[1], want[1])),
    Math.max(d(got[0], want[1]), d(got[1], want[0])),
  )
}

export function buildTaperFromEndSegments(a: EndSegment, b: EndSegment): Built | null {
  const vertical =
    Math.abs(a[0].x - a[1].x) <= AXIS_EPS && Math.abs(b[0].x - b[1].x) <= AXIS_EPS
  const horizontal =
    Math.abs(a[0].y - a[1].y) <= AXIS_EPS && Math.abs(b[0].y - b[1].y) <= AXIS_EPS
  if (!vertical && !horizontal) return null

  const xs = [a[0].x, a[1].x, b[0].x, b[1].x]
  const ys = [a[0].y, a[1].y, b[0].y, b[1].y]
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
  if (box.w < 1 || box.h < 1) return null

  /*
   * 端面在形狀自己的座標系裡是「左緣 x=0、右緣 x=w」的垂直線段，由四個比例描述。
   * 把目標線段換算成比例的方式只有兩種——沿著外框的哪一個軸，以及兩端誰在前面；
   * 四種方位 × 兩種配對全部算出來再驗證。
   */
  const along = (p: { x: number; y: number }) => (vertical ? p.y : p.x)
  const span = vertical ? box.h : box.w
  const base = vertical ? box.y : box.x
  const r = (p: { x: number; y: number }) => (along(p) - base) / span

  let best: { built: Built; err: number } | null = null
  for (const entryDeg of QUARTERS) {
    for (const flip of [false, true]) {
      const left = flip ? b : a
      const right = flip ? a : b
      for (const rev of [false, true]) {
        const geometry: TaperTrackGeometry = {
          aFrom: rev ? 1 - r(left[0]) : r(left[0]),
          aTo: rev ? 1 - r(left[1]) : r(left[1]),
          bFrom: rev ? 1 - r(right[0]) : r(right[0]),
          bTo: rev ? 1 - r(right[1]) : r(right[1]),
          entryDeg,
        }
        const segs = taperTrackEndSegmentsPx(geometry, box.w, box.h)
        const shift = (p: { x: number; y: number }) => ({ x: box.x + p.x, y: box.y + p.y })
        const gotA: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
        const gotB: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
        const err = Math.max(
          Math.min(segError(gotA, a) + segError(gotB, b), segError(gotA, b) + segError(gotB, a)),
          0,
        )
        if (!best || err < best.err) best = { built: { geometry, box }, err }
      }
    }
  }
  if (!best || best.err > 2) return null
  return best.built
}
