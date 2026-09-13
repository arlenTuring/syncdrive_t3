import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  DEFAULT_SWITCH_TRACK,
  normalizeSwitchTrackGeometry,
  readSwitchTrack,
  SWITCH_TRACK_KEY,
  switchTrackEndSegmentsPx,
  switchTrackPartPaths,
} from './trackShapes'
import { alignSwitchFaces, buildSwitchFromEndSegments } from './switchJoin'

function rotateSeg(
  seg: [{ x: number; y: number }, { x: number; y: number }],
  cx: number,
  cy: number,
  deg: number,
): [{ x: number; y: number }, { x: number; y: number }] {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rot = (p: { x: number; y: number }) => {
    const dx = p.x - cx
    const dy = p.y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
  return [rot(seg[0]), rot(seg[1])]
}

function isButterfly(g: typeof DEFAULT_SWITCH_TRACK): boolean {
  return (g.aTo - g.aFrom) * (g.mTo - g.mFrom) < 0
}

describe('normalizeSwitchTrackGeometry', () => {
  it('untangles opposite a/m from→to', () => {
    const knotted = normalizeSwitchTrackGeometry({
      ...DEFAULT_SWITCH_TRACK,
      aFrom: 0.34,
      aTo: 0,
      mFrom: 0,
      mTo: 0.34,
    })
    assert.equal(isButterfly(knotted), false)
    assert.ok(knotted.aFrom < knotted.aTo)
  })

  it('readSwitchTrack normalizes stored butterfly data', () => {
    const g = readSwitchTrack({
      [SWITCH_TRACK_KEY]: {
        ...DEFAULT_SWITCH_TRACK,
        aFrom: 0.34,
        aTo: 0,
        mFrom: 0,
        mTo: 0.34,
      },
    })
    assert.equal(isButterfly(g), false)
  })
})

describe('buildSwitchFromEndSegments after CSS rotation', () => {
  it('does not flip from/to into a butterfly for 90° steps', () => {
    const g0 = { ...DEFAULT_SWITCH_TRACK }
    const w = 84
    const h = 191
    const segs = switchTrackEndSegmentsPx(g0, w, h)
    const cx = w / 2
    const cy = h / 2

    for (const deg of [0, 90, 180, 270, -90, 45]) {
      const world = {
        a: rotateSeg(segs.a, cx, cy, deg),
        m: rotateSeg(segs.m, cx, cy, deg),
        b: rotateSeg(segs.b, cx, cy, deg),
      }
      if (deg % 90 !== 0) {
        assert.equal(buildSwitchFromEndSegments(world.a, world.m, world.b), null)
        continue
      }
      const built = buildSwitchFromEndSegments(world.a, world.m, world.b)
      assert.ok(built, `deg=${deg} should rebuild`)
      assert.equal(
        isButterfly(built.geometry),
        false,
        `deg=${deg} butterfly geometry=${JSON.stringify(built.geometry)}`,
      )
      const paths = switchTrackPartPaths(built.geometry, built.box.w, built.box.h)
      assert.ok(paths.straight.includes('M'))
      assert.ok(paths.branch.includes('M'))
    }
  })
})

describe('buildSwitchFromEndSegments with reversed target face', () => {
  it('avoids butterfly when joined face endpoints are reversed', () => {
    const g0 = { ...DEFAULT_SWITCH_TRACK }
    const w = 100
    const h = 200
    const segs = switchTrackEndSegmentsPx(g0, w, h)
    const shifted: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: segs.a[1].x - 20, y: segs.a[1].y },
      { x: segs.a[0].x - 20, y: segs.a[0].y },
    ]
    const aligned = alignSwitchFaces(
      { a: segs.a, m: segs.m, b: segs.b },
      'a',
      shifted,
    )
    assert.ok(aligned)
    const built = buildSwitchFromEndSegments(aligned.a, aligned.m, aligned.b)
    assert.ok(built)
    assert.equal(isButterfly(built.geometry), false, JSON.stringify(built.geometry))
  })

  it('buildSwitch alone still normalizes reversed a endpoints', () => {
    const g0 = { ...DEFAULT_SWITCH_TRACK }
    const w = 100
    const h = 200
    const segs = switchTrackEndSegmentsPx(g0, w, h)
    const shifted: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: segs.a[1].x - 20, y: segs.a[1].y },
      { x: segs.a[0].x - 20, y: segs.a[0].y },
    ]
    const built = buildSwitchFromEndSegments(shifted, segs.m, segs.b)
    assert.ok(built)
    assert.equal(isButterfly(built.geometry), false, JSON.stringify(built.geometry))
  })
})
