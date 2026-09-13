import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { FacilityObject } from '../types/facility'
import { SWITCH_TRACK_KEY, DEFAULT_SWITCH_TRACK, readSwitchTrack } from './trackShapes'
import { bakeShapedTrackRotation, isShapedTrackFacility } from './shapedTrackRotation'

function switchFacility(
  over: Partial<FacilityObject> & { parameters?: Record<string, unknown> } = {},
): FacilityObject {
  return {
    id: 's1',
    type: 'Track',
    name: 'RailSwitch',
    customName: '',
    areaPosition: { x: 100, y: 100 },
    areaSizePx: { w: 80, h: 200 },
    position: { x: 1, y: 1 },
    rotation: 0,
    currentState: 'Idle',
    parameters: {
      [SWITCH_TRACK_KEY]: { ...DEFAULT_SWITCH_TRACK },
    },
    ...over,
    parameters: {
      [SWITCH_TRACK_KEY]: { ...DEFAULT_SWITCH_TRACK },
      ...(over.parameters ?? {}),
    },
  }
}

describe('bakeShapedTrackRotation', () => {
  it('recognizes shaped tracks', () => {
    assert.equal(isShapedTrackFacility(switchFacility()), true)
  })

  it('bakes +90° into entryDeg, swaps box, clears CSS rotation', () => {
    const f = switchFacility()
    const next = bakeShapedTrackRotation(f, 90)
    assert.equal(next.rotation, 0)
    assert.equal(readSwitchTrack(next.parameters).entryDeg, 90)
    assert.equal(next.areaSizePx?.w, 200)
    assert.equal(next.areaSizePx?.h, 80)
    // centre preserved
    assert.equal(
      (next.areaPosition.x + (next.areaSizePx?.w ?? 0) / 2).toFixed(3),
      (100 + 40).toFixed(3),
    )
    assert.equal(
      (next.areaPosition.y + (next.areaSizePx?.h ?? 0) / 2).toFixed(3),
      (100 + 100).toFixed(3),
    )
  })

  it('folds existing CSS rotation then adds delta', () => {
    const f = switchFacility({ rotation: 90 })
    const next = bakeShapedTrackRotation(f, 90)
    assert.equal(next.rotation, 0)
    assert.equal(readSwitchTrack(next.parameters).entryDeg, 180)
    // 90+90 → two swaps → original aspect
    assert.equal(next.areaSizePx?.w, 80)
    assert.equal(next.areaSizePx?.h, 200)
  })

  it('snaps free-rotate residue to nearest 90°', () => {
    const f = switchFacility({ rotation: 0 })
    const next = bakeShapedTrackRotation(f, 40)
    assert.equal(next.rotation, 0)
    assert.equal(readSwitchTrack(next.parameters).entryDeg, 0)
    const next2 = bakeShapedTrackRotation(f, 50)
    assert.equal(readSwitchTrack(next2.parameters).entryDeg, 90)
  })
})
