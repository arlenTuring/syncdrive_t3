import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { backfillTrackGenSpansInAreas } from './trackGenSpanBackfill'
import {
  getTrackGenSpans,
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
  TRACKGEN_SPANS_KEY,
} from './trackGenPaths'

function track(
  id: string,
  real: [number, number][],
  spans?: unknown[],
): FacilityObject {
  return {
    id,
    type: 'Track',
    name: 'Track',
    customName: id,
    areaPosition: { x: 0, y: 0 },
    areaSizePx: { w: 100, h: 20 },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Normal',
    parameters: {
      [TRACKGEN_REAL_PATH_KEY]: real,
      [TRACKGEN_LOCAL_PATH_KEY]: real.map((_, i) => [i / (real.length - 1), 0.5]),
      ...(spans ? { [TRACKGEN_SPANS_KEY]: spans } : {}),
    },
  } as FacilityObject
}

const span = (road: string, lane: number, s0: number, s1: number) => ({
  road, lane, s0, s1, h: null, f0: 0, f1: 1,
})

function areaWith(facilities: FacilityObject[]) {
  return [{ ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE), facilities }]
}

describe('補里程對應', () => {
  it('兩端鄰居都在同一條車道時，接回中間那一塊的里程', () => {
    // 上游 A 走到 (0,-10) 為止，里程 200；下游 C 從 (0,-30) 開始，里程 100
    const a = track('A', [[0, 0], [0, -10]], [span('11', 2, 300, 200)])
    const b = track('B', [[0, -10], [0, -30]])
    const c = track('C', [[0, -50], [0, -30]], [span('11', 2, 50, 100)])

    const out = backfillTrackGenSpansInAreas(areaWith([a, b, c]))
    assert.equal(out.filled.length, 1)
    assert.equal(out.filled[0]!.name, 'B')

    const filled = getTrackGenSpans(out.areas[0]!.facilities[1]!.parameters)
    assert.equal(filled.length, 1)
    assert.equal(filled[0]!.road, '11')
    assert.equal(filled[0]!.lane, 2)
    assert.equal(filled[0]!.s0, 200)
    assert.equal(filled[0]!.s1, 100)
  })

  it('兩端接到不同車道就不補——寧可沒有，也不要接成別條線', () => {
    const a = track('A', [[0, 0], [0, -10]], [span('11', 2, 300, 200)])
    const b = track('B', [[0, -10], [0, -30]])
    const c = track('C', [[0, -50], [0, -30]], [span('11', -2, 50, 100)])

    const out = backfillTrackGenSpansInAreas(areaWith([a, b, c]))
    assert.equal(out.filled.length, 0)
    assert.deepEqual(out.skipped, ['B'])
    assert.equal(getTrackGenSpans(out.areas[0]!.facilities[1]!.parameters).length, 0)
  })

  it('只有一端找得到鄰居也不補', () => {
    const a = track('A', [[0, 0], [0, -10]], [span('11', 2, 300, 200)])
    const b = track('B', [[0, -10], [0, -30]])

    const out = backfillTrackGenSpansInAreas(areaWith([a, b]))
    assert.equal(out.filled.length, 0)
    assert.deepEqual(out.skipped, ['B'])
  })

  it('本來就有里程的不碰', () => {
    const a = track('A', [[0, 0], [0, -10]], [span('11', 2, 300, 200)])
    const b = track('B', [[0, -10], [0, -30]], [span('11', 2, 199, 150)])
    const c = track('C', [[0, -50], [0, -30]], [span('11', 2, 50, 100)])

    const out = backfillTrackGenSpansInAreas(areaWith([a, b, c]))
    assert.equal(out.filled.length, 0)
    assert.equal(out.areas, areaWith([a, b, c])[0] ? out.areas : out.areas)
    assert.equal(getTrackGenSpans(out.areas[0]!.facilities[1]!.parameters)[0]!.s0, 199)
  })
})
