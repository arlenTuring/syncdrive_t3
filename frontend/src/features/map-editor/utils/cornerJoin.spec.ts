import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alignCornerFaces,
  buildCornerFromEndSegments,
  type EndSegment,
} from './cornerJoin'
import { cornerTrackEndSegmentsPx } from './trackShapes'

function segLen(s: EndSegment) {
  return Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)
}

describe('alignCornerFaces / buildCornerFromEndSegments', () => {
  it('adapts joining face width to a narrower opponent end', () => {
    const cur = {
      a: [
        { x: 200, y: 100 },
        { x: 200, y: 140 },
      ] as EndSegment,
      b: [
        { x: 160, y: 200 },
        { x: 200, y: 200 },
      ] as EndSegment,
    }
    const narrow: EndSegment = [
      { x: 170, y: 200 },
      { x: 190, y: 200 },
    ]
    const aligned = alignCornerFaces(cur, 'b', narrow)
    assert.ok(aligned)
    assert.equal(segLen(aligned!.b), 20)
    assert.ok(Math.abs(segLen(aligned!.a) - 40) < 0.01)

    const built = buildCornerFromEndSegments(aligned!.a, aligned!.b)
    assert.ok(built)
    const segs = cornerTrackEndSegmentsPx(built!.geometry, built!.box.w, built!.box.h)
    const shift = (p: { x: number; y: number }) => ({
      x: built!.box.x + p.x,
      y: built!.box.y + p.y,
    })
    const gotB: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
    const gotA: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
    const lengths = [segLen(gotA), segLen(gotB)].sort((p, q) => p - q)
    assert.ok(Math.abs(lengths[0]! - 20) < 2)
    assert.ok(Math.abs(lengths[1]! - 40) < 2)
  })

  it('rejects when opposite face is parallel to target', () => {
    const cur = {
      a: [
        { x: 40, y: 200 },
        { x: 80, y: 200 },
      ] as EndSegment,
      b: [
        { x: 100, y: 200 },
        { x: 140, y: 200 },
      ] as EndSegment,
    }
    const target: EndSegment = [
      { x: 100, y: 200 },
      { x: 140, y: 200 },
    ]
    assert.equal(alignCornerFaces(cur, 'b', target), null)
  })
})
