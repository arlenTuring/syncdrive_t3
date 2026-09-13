import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FacilityObject } from '../types/facility'
import {
  getTrackGenPartStyle,
  patchTrackGenPartStyle,
  TRACKGEN_PART_STYLES_KEY,
} from './trackGenParts'
import { switchTrackPath, DEFAULT_SWITCH_TRACK } from './trackShapes'

function switchFacility(
  styles?: Record<string, string>,
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
    currentState: 'Normal',
    parameters: {
      ...(styles ? { [TRACKGEN_PART_STYLES_KEY]: styles } : {}),
    },
  }
}

describe('trackGenPartStyles', () => {
  it('defaults to fill', () => {
    const f = switchFacility()
    assert.equal(getTrackGenPartStyle(f, 'straight'), 'fill')
    assert.equal(getTrackGenPartStyle(f, 'branch'), 'fill')
  })

  it('patches dashed and clears back to fill', () => {
    const f = switchFacility()
    const dashed = patchTrackGenPartStyle(f, 'branch', 'dashed')
    const withDash: FacilityObject = {
      ...f,
      parameters: { ...f.parameters, ...dashed },
    }
    assert.equal(getTrackGenPartStyle(withDash, 'branch'), 'dashed')
    assert.equal(getTrackGenPartStyle(withDash, 'straight'), 'fill')

    const cleared = patchTrackGenPartStyle(withDash, 'branch', 'fill')
    const styles = cleared[TRACKGEN_PART_STYLES_KEY] as Record<string, string>
    assert.equal(styles.branch, undefined)
  })
})

describe('switchTrackPath part filter', () => {
  it('omits dashed parts from fill path', () => {
    const both = switchTrackPath(DEFAULT_SWITCH_TRACK, 100, 80)
    const straightOnly = switchTrackPath(DEFAULT_SWITCH_TRACK, 100, 80, {
      includeBranch: false,
    })
    const branchOnly = switchTrackPath(DEFAULT_SWITCH_TRACK, 100, 80, {
      includeStraight: false,
    })
    assert.ok(both.length > straightOnly.length)
    assert.ok(both.length > branchOnly.length)
    assert.ok(straightOnly.includes('M'))
    assert.ok(branchOnly.includes('M'))
  })
})
