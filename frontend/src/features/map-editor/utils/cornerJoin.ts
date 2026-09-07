import {
  cornerTrackEndSegmentsPx,
  cornerArcCentrePx,
  type CornerTrackGeometry,
} from './trackShapes'
import type { EndSegment } from './taperJoin'

/**
 * 由兩條端面線段反推圓角軌道的外框與幾何。
 *
 * 圓心取「縱向那一面的 x、橫向那一面的 y」。兩個面必須一橫一縱，不成立時回 null。
 */

const AXIS_EPS = 1.5
const QUARTERS = [0, 90, 180, 270] as const

type Built = {
  geometry: CornerTrackGeometry
  box: { x: number; y: number; w: number; h: number }
}

function segError(got: EndSegment, want: EndSegment): number {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y)
  return Math.min(
    Math.max(d(got[0], want[0]), d(got[1], want[1])),
    Math.max(d(got[0], want[1]), d(got[1], want[0])),
  )
}

export function buildCornerFromEndSegments(a: EndSegment, b: EndSegment): Built | null {
  const flat = (s: EndSegment, axis: 'x' | 'y') => Math.abs(s[0][axis] - s[1][axis]) <= AXIS_EPS
  // 一條直的、一條橫的才轉得了彎；誰是誰兩種都試
  const pairs: Array<[EndSegment, EndSegment]> = []
  if (flat(a, 'x') && flat(b, 'y')) pairs.push([a, b])
  if (flat(b, 'x') && flat(a, 'y')) pairs.push([b, a])
  if (!pairs.length) return null

  let best: { built: Built; err: number } | null = null
  for (const [vert, horiz] of pairs) {
    // 圓心：直的那條面的 x、橫的那條面的 y
    const C = {
      x: (vert[0].x + vert[1].x) / 2,
      y: (horiz[0].y + horiz[1].y) / 2,
    }
    // 半徑＝端點離圓心多遠；遠的是外弧、近的是內弧
    const dy = [Math.abs(vert[0].y - C.y), Math.abs(vert[1].y - C.y)].sort((p, q) => p - q)
    const dx = [Math.abs(horiz[0].x - C.x), Math.abs(horiz[1].x - C.x)].sort((p, q) => p - q)
    const iry = dy[0]!
    const ry = dy[1]!
    const irx = dx[0]!
    const rx = dx[1]!
    if (!(ry > 1) || !(rx > 1)) continue

    for (const entryDeg of QUARTERS) {
      /*
       * 旋轉會把長寬對調，所以「哪一對半徑落在旋轉後的哪一個軸」有兩種可能——量到的是
       * <strong>畫面上</strong>的直橫，元件內部的直橫則跟著方位轉。兩種都試，比例照旋轉
       * 後的邊長算，帶寬兩端才一致。
       */
      for (const [ow, iw, oh, ih] of [
        [rx, irx, ry, iry],
        [ry, iry, rx, irx],
      ]) {
        const swap = (Math.round((((entryDeg % 360) + 360) % 360) / 90) & 3) % 2 === 1
        const w = Math.max(1e-3, ow!)
        const h = Math.max(1e-3, oh!)
        // 旋轉後的邊長是 w／h，外框自己的長寬要反推回去
        const boxW = swap ? h : w
        const boxH = swap ? w : h
        const geometry: CornerTrackGeometry = {
          arcXRatio: 1,
          arcYRatio: 1,
          innerXRatio: Math.max(0, Math.min(0.98, iw! / w)),
          innerYRatio: Math.max(0, Math.min(0.98, ih! / h)),
          outerBulge: 1,
          innerBulge: 1,
          entryDeg,
        }
        const off = cornerArcCentrePx(entryDeg, boxW, boxH)
        const box = { x: C.x - off.x, y: C.y - off.y, w: boxW, h: boxH }
        const segs = cornerTrackEndSegmentsPx(geometry, boxW, boxH)
        const shift = (p: { x: number; y: number }) => ({ x: box.x + p.x, y: box.y + p.y })
        const gotA: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
        const gotB: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
        const err = Math.min(
          Math.max(segError(gotA, vert), segError(gotB, horiz)),
          Math.max(segError(gotA, horiz), segError(gotB, vert)),
        )
        if (!best || err < best.err) best = { built: { geometry, box }, err }
      }
    }
  }
  if (!best || best.err > 2) return null
  return best.built
}
