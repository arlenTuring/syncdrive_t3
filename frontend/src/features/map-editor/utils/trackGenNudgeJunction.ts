import { buildCornerFromEndSegments } from './cornerJoin'
import { buildCrossFromEndSegments } from './crossJoin'
import { buildSwitchFromEndSegments } from './switchJoin'
import type { LayoutShape, Vec2 } from './trackGenLayout'
import {
  cornerTrackEndSegmentsPx,
  crossTrackEndSegmentsPx,
  switchTrackEndSegmentsPx,
  type CrossHandleKey,
  type CrossTrackGeometry,
  type SwitchHandleKey,
  type SwitchTrackGeometry,
  type CornerTrackGeometry,
} from './trackShapes'
import type { EndSegment } from './taperJoin'

type Axis = 'x' | 'y'

/**
 * 路口各口獨立伸縮（分岔主線／岔線、交叉上下行）。
 *
 * 形狀由端面決定——跟合併吃直軌同一套路：挪一個口再解一次幾何，其餘口不動。
 */

export type JunctionMouth = SwitchHandleKey | CrossHandleKey | 'cornerA' | 'cornerB'

export const SWITCH_MOUTHS: SwitchHandleKey[] = ['a', 'm', 'b']
export const CROSS_MOUTHS: CrossHandleKey[] = ['lt', 'lb', 'rt', 'rb']

const MIN_FACE = 4

function mid(seg: EndSegment): Vec2 {
  return { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
}

function translate(seg: EndSegment, dx: number, dy: number): EndSegment {
  return [
    { x: seg[0].x + dx, y: seg[0].y + dy },
    { x: seg[1].x + dx, y: seg[1].y + dy },
  ]
}

/** 端面沿著哪一軸推進（面與行進方向垂直） */
export function mouthAxis(seg: EndSegment): Axis {
  const dx = Math.abs(seg[0].x - seg[1].x)
  const dy = Math.abs(seg[0].y - seg[1].y)
  // 面幾乎鉛直 → 沿 x 拉；幾乎水平 → 沿 y 拉
  return dx <= dy ? 'x' : 'y'
}

function worldSegsSwitch(s: LayoutShape & { kind: 'switch' }) {
  const g = s.geometry as SwitchTrackGeometry
  const local = switchTrackEndSegmentsPx(g, s.box.wM, s.box.hM)
  const off = (p: Vec2): Vec2 => ({ x: s.box.xM + p.x, y: s.box.yM + p.y })
  return {
    a: [off(local.a[0]), off(local.a[1])] as EndSegment,
    m: [off(local.m[0]), off(local.m[1])] as EndSegment,
    b: [off(local.b[0]), off(local.b[1])] as EndSegment,
  }
}

function worldSegsCross(s: LayoutShape & { kind: 'cross' }) {
  const g = s.geometry as CrossTrackGeometry
  const local = crossTrackEndSegmentsPx(g, s.box.wM, s.box.hM)
  const off = (p: Vec2): Vec2 => ({ x: s.box.xM + p.x, y: s.box.yM + p.y })
  return {
    lt: [off(local.lt[0]), off(local.lt[1])] as EndSegment,
    lb: [off(local.lb[0]), off(local.lb[1])] as EndSegment,
    rt: [off(local.rt[0]), off(local.rt[1])] as EndSegment,
    rb: [off(local.rb[0]), off(local.rb[1])] as EndSegment,
  }
}

function worldSegsCorner(s: LayoutShape & { kind: 'corner' }) {
  const g = s.geometry as CornerTrackGeometry
  const local = cornerTrackEndSegmentsPx(g, s.box.wM, s.box.hM)
  const off = (p: Vec2): Vec2 => ({ x: s.box.xM + p.x, y: s.box.yM + p.y })
  return {
    cornerA: [off(local.a[0]), off(local.a[1])] as EndSegment,
    cornerB: [off(local.b[0]), off(local.b[1])] as EndSegment,
  }
}

/** 這一塊有哪些可拖的口，以及每個口目前在版面上的位置 */
export function junctionMouthsOf(
  s: LayoutShape,
): { mouth: JunctionMouth; seg: EndSegment; axis: Axis; at: number }[] {
  if (s.kind === 'switch') {
    const w = worldSegsSwitch(s)
    return SWITCH_MOUTHS.map((mouth) => {
      const seg = w[mouth]
      const axis = mouthAxis(seg)
      const m = mid(seg)
      return { mouth, seg, axis, at: axis === 'x' ? m.x : m.y }
    })
  }
  if (s.kind === 'cross') {
    const w = worldSegsCross(s)
    return CROSS_MOUTHS.map((mouth) => {
      const seg = w[mouth]
      const axis = mouthAxis(seg)
      const m = mid(seg)
      return { mouth, seg, axis, at: axis === 'x' ? m.x : m.y }
    })
  }
  if (s.kind === 'corner') {
    const w = worldSegsCorner(s)
    return (['cornerA', 'cornerB'] as const).map((mouth) => {
      const seg = w[mouth]
      const axis = mouthAxis(seg)
      const m = mid(seg)
      return { mouth, seg, axis, at: axis === 'x' ? m.x : m.y }
    })
  }
  return []
}

export function junctionMouthSeg(s: LayoutShape, mouth: JunctionMouth): EndSegment | null {
  const hit = junctionMouthsOf(s).find((m) => m.mouth === mouth)
  return hit?.seg ?? null
}

function applySwitchWorld(
  s: LayoutShape & { kind: 'switch' },
  next: { a: EndSegment; m: EndSegment; b: EndSegment },
): LayoutShape | null {
  const span = (a: EndSegment, b: EndSegment) => {
    const ax = mouthAxis(a)
    const am = mid(a)
    const bm = mid(b)
    return Math.abs(ax === 'x' ? am.x - bm.x : am.y - bm.y)
  }
  if (span(next.a, next.m) < MIN_FACE || span(next.a, next.b) < MIN_FACE) return null
  const built = buildSwitchFromEndSegments(next.a, next.m, next.b)
  if (!built) return null
  const ma = mid(next.a)
  const mm = mid(next.m)
  const mb = mid(next.b)
  return {
    ...s,
    geometry: built.geometry,
    box: { xM: built.box.x, yM: built.box.y, wM: built.box.w, hM: built.box.h },
    samples: [ma, { x: (mm.x + mb.x) / 2, y: (mm.y + mb.y) / 2 }, mm, mb],
  }
}

/**
 * 挪一個口再解幾何。dPx 沿該口行進軸，正值往座標大的方向。
 *
 * 分岔／交叉各口<strong>獨立</strong>伸縮；旁邊接上的軌道由微調層負責跟著補長度。
 * 圓角：只挪那一個口，外弧／內弧的 bulge（曲率形狀）沿用原值；半徑會隨開口距離
 * 微調，否則端面無法對上旁邊的直線。
 */
export function resizeJunctionMouth(
  s: LayoutShape,
  mouth: JunctionMouth,
  dPx: number,
): LayoutShape | null {
  if (Math.abs(dPx) < 1e-9) return null
  if (s.kind === 'switch') {
    if (mouth !== 'a' && mouth !== 'm' && mouth !== 'b') return null
    const world = worldSegsSwitch(s)
    const seg = world[mouth]
    const axis = mouthAxis(seg)
    const moved = translate(seg, axis === 'x' ? dPx : 0, axis === 'y' ? dPx : 0)
    return applySwitchWorld(s, { ...world, [mouth]: moved })
  }
  if (s.kind === 'cross') {
    if (mouth !== 'lt' && mouth !== 'lb' && mouth !== 'rt' && mouth !== 'rb') return null
    const world = worldSegsCross(s)
    const seg = world[mouth]
    const axis = mouthAxis(seg)
    const moved = translate(seg, axis === 'x' ? dPx : 0, axis === 'y' ? dPx : 0)
    const next = { ...world, [mouth]: moved }
    const pair =
      mouth === 'lt' || mouth === 'rt'
        ? ([next.lt, next.rt] as const)
        : ([next.lb, next.rb] as const)
    const pa = mid(pair[0])
    const pb = mid(pair[1])
    if (Math.abs(axis === 'x' ? pa.x - pb.x : pa.y - pb.y) < MIN_FACE) return null
    const built = buildCrossFromEndSegments(next)
    if (!built) return null
    const cy = built.box.y + built.box.h / 2
    return {
      ...s,
      geometry: built.geometry,
      box: { xM: built.box.x, yM: built.box.y, wM: built.box.w, hM: built.box.h },
      samples: [
        { x: built.box.x, y: cy },
        { x: built.box.x + built.box.w, y: cy },
      ],
    }
  }
  if (s.kind === 'corner') {
    if (mouth !== 'cornerA' && mouth !== 'cornerB') return null
    const world = worldSegsCorner(s)
    const seg = world[mouth]
    const axis = mouthAxis(seg)
    const moved = translate(seg, axis === 'x' ? dPx : 0, axis === 'y' ? dPx : 0)
    const next = {
      cornerA: mouth === 'cornerA' ? moved : world.cornerA,
      cornerB: mouth === 'cornerB' ? moved : world.cornerB,
    }
    const pa = mid(next.cornerA)
    const pb = mid(next.cornerB)
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < MIN_FACE) return null
    const built = buildCornerFromEndSegments(next.cornerA, next.cornerB)
    if (!built) return null
    const prev = s.geometry as CornerTrackGeometry
    const ends = {
      a: mid(next.cornerA),
      b: mid(next.cornerB),
    }
    return {
      ...s,
      geometry: {
        ...built.geometry,
        // 曲率形狀（bulge）沿用，不重設成直角折線感
        outerBulge: prev.outerBulge,
        innerBulge: prev.innerBulge,
      },
      box: { xM: built.box.x, yM: built.box.y, wM: built.box.w, hM: built.box.h },
      outerRadiusM: Math.max(built.box.w, built.box.h),
      samples: [ends.a, ends.b],
    }
  }
  return null
}

/** 這個口的中點（找鄰居用） */
export function junctionMouthJoint(s: LayoutShape, mouth: JunctionMouth): Vec2 | null {
  const seg = junctionMouthSeg(s, mouth)
  return seg ? mid(seg) : null
}
