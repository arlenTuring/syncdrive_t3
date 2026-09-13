import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FacilityObject } from '../types/facility'
import {
  getTrackGenPartLabelOffset,
  patchTrackGenPartLabelOffset,
  TRACKGEN_PART_LABEL_OFFSETS_KEY,
} from './trackGenParts'

function switchFacility(
  offsets?: Record<string, { x: number; y: number }>,
): FacilityObject {
  return {
    id: 's1',
    type: 'Track',
    name: 'RailSwitch',
    customName: '',
    areaPosition: { x: 0, y: 0 },
    areaSizePx: { w: 100, h: 80 },
    position: { x: 0, y: 0 },
    rotation: 0,
    currentState: 'Idle',
    parameters: offsets
      ? { [TRACKGEN_PART_LABEL_OFFSETS_KEY]: offsets }
      : {},
  }
}

describe('trackGenPartLabelOffsets', () => {
  it('defaults to origin', () => {
    const f = switchFacility()
    assert.deepEqual(getTrackGenPartLabelOffset(f, 'straight'), { x: 0, y: 0 })
    assert.deepEqual(getTrackGenPartLabelOffset(f, 'branch'), { x: 0, y: 0 })
  })

  it('patches and clears near-zero offsets', () => {
    const f = switchFacility()
    const patch = patchTrackGenPartLabelOffset(f, 'branch', { x: 12, y: -4 })
    const withOff: FacilityObject = {
      ...f,
      parameters: { ...f.parameters, ...patch },
    }
    assert.deepEqual(getTrackGenPartLabelOffset(withOff, 'branch'), {
      x: 12,
      y: -4,
    })
    const cleared = patchTrackGenPartLabelOffset(withOff, 'branch', {
      x: 0.1,
      y: -0.2,
    })
    const styles = cleared[TRACKGEN_PART_LABEL_OFFSETS_KEY] as Record<
      string,
      unknown
    >
    assert.equal(styles.branch, undefined)
  })
})
