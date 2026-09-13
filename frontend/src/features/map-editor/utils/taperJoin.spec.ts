import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alignTaperFaces,
  buildTaperFromEndSegments,
  type EndSegment,
} from './taperJoin'
import { taperTrackEndSegmentsPx } from './trackShapes'

describe('alignTaperFaces / buildTaperFromEndSegments', () => {
  it('joins a vertical face to a wider horizontal track end by adapting width', () => {
    const cur = {
      a: [
        { x: 40, y: 40 },
        { x: 40, y: 70 },
      ] as EndSegment,
      b: [
        { x: 120, y: 50 },
        { x: 120, y: 80 },
      ] as EndSegment,
    }
    const u18Top: EndSegment = [
      { x: 100, y: 200 },
      { x: 160, y: 200 },
    ]
    assert.equal(buildTaperFromEndSegments(u18Top, cur.a), null)

    const aligned = alignTaperFaces(cur, 'b', u18Top)
    assert.ok(aligned)
    assert.equal(aligned!.b[0].x, 100)
    assert.equal(aligned!.b[1].x, 160)
    assert.equal(aligned!.b[0].y, 200)
    assert.ok(Math.abs(aligned!.a[0].y - aligned!.a[1].y) < 1.5)

    const built = buildTaperFromEndSegments(aligned!.a, aligned!.b)
    assert.ok(built)
    const ga = Math.abs(built!.geometry.aTo - built!.geometry.aFrom)
    const gb = Math.abs(built!.geometry.bTo - built!.geometry.bFrom)
    assert.ok(
      Math.abs(ga - gb) > 0.05 ||
        Math.abs(built!.geometry.aFrom - built!.geometry.bFrom) > 0.05,
    )
  })

  it('keeps opposite face when already parallel and only widens the joining end', () => {
    const cur = {
      a: [
        { x: 50, y: 40 },
        { x: 100, y: 40 },
      ] as EndSegment,
      b: [
        { x: 70, y: 120 },
        { x: 110, y: 120 },
      ] as EndSegment,
    }
    const wider: EndSegment = [
      { x: 40, y: 120 },
      { x: 140, y: 120 },
    ]
    const aligned = alignTaperFaces(cur, 'b', wider)
    assert.ok(aligned)
    assert.deepEqual(aligned!.a, orientExpected(cur.a))
    assert.deepEqual(aligned!.b, wider)
    const built = buildTaperFromEndSegments(aligned!.a, aligned!.b)
    assert.ok(built)
    const faceA = Math.abs(built!.geometry.aTo - built!.geometry.aFrom)
    const faceB = Math.abs(built!.geometry.bTo - built!.geometry.bFrom)
    assert.ok(faceB > faceA)
  })

  it('does not knot when end-point order is reversed between faces', () => {
    // 窄端與寬端端點順序相反 → 舊邏輯會打成沙漏
    const narrow: EndSegment = [
      { x: 100, y: 40 },
      { x: 50, y: 40 },
    ]
    const wide: EndSegment = [
      { x: 40, y: 120 },
      { x: 140, y: 120 },
    ]
    const built = buildTaperFromEndSegments(narrow, wide)
    assert.ok(built)
    const segs = taperTrackEndSegmentsPx(built!.geometry, built!.box.w, built!.box.h)
    const shift = (p: { x: number; y: number }) => ({
      x: built!.box.x + p.x,
      y: built!.box.y + p.y,
    })
    const a: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
    const b: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
    // 長邊 aFrom–bFrom 與 aTo–bTo 不可相交
    assert.equal(edgesCross(a[0], b[0], a[1], b[1]), false)
    // from/to 同向
    assert.equal(
      Math.sign(built!.geometry.aTo - built!.geometry.aFrom) *
        Math.sign(built!.geometry.bTo - built!.geometry.bFrom) >=
        0,
      true,
    )
  })

  it('narrows joining face to match a shorter corner end (keeps opposite width)', () => {
    const cur = {
      a: [
        { x: 80, y: 40 },
        { x: 160, y: 40 },
      ] as EndSegment,
      b: [
        { x: 90, y: 120 },
        { x: 170, y: 120 },
      ] as EndSegment,
    }
    const cornerEnd: EndSegment = [
      { x: 100, y: 40 },
      { x: 140, y: 40 },
    ]
    const aligned = alignTaperFaces(cur, 'a', cornerEnd)
    assert.ok(aligned)
    assert.equal(aligned!.a[0].x, 100)
    assert.equal(aligned!.a[1].x, 140)
    const built = buildTaperFromEndSegments(aligned!.a, aligned!.b)
    assert.ok(built)
    const segs = taperTrackEndSegmentsPx(built!.geometry, built!.box.w, built!.box.h)
    const shift = (p: { x: number; y: number }) => ({
      x: built!.box.x + p.x,
      y: built!.box.y + p.y,
    })
    const gotA: EndSegment = [shift(segs.a[0]), shift(segs.a[1])]
    const gotB: EndSegment = [shift(segs.b[0]), shift(segs.b[1])]
    const len = (s: EndSegment) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)
    const top = Math.abs(gotA[0].y - 40) < 2 ? gotA : gotB
    assert.ok(Math.abs(len(top) - 40) < 2)
  })
})

function orientExpected(s: EndSegment): EndSegment {
  return s[0].x <= s[1].x ? s : [s[1], s[0]]
}

function edgesCross(
  p1: { x: number; y: number },
  q1: { x: number; y: number },
  p2: { x: number; y: number },
  q2: { x: number; y: number },
): boolean {
  const orient = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y))
  const o1 = orient(p1, q1, p2)
  const o2 = orient(p1, q1, q2)
  const o3 = orient(p2, q2, p1)
  const o4 = orient(p2, q2, q1)
  return o1 !== o2 && o3 !== o4
}
