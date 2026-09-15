import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  refFieldBoundsDriftM,
  repairTrackRefFieldBoundsInAreas,
  TRACK_REF_FIELD_BOUNDS_TOLERANCE_M,
} from './trackRefFieldBoundsRepair'
import {
  getValidRefFieldBounds,
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'

/** 中心線走 (0,0)→(0,-100)，往兩側撐半個車道後應為 x ±1.675、y -101.675~1.675 */
function track(
  id: string,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
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
      [TRACKGEN_REAL_PATH_KEY]: [[0, 0], [0, -100]],
      [TRACKGEN_LOCAL_PATH_KEY]: [[0.5, 0], [0.5, 1]],
      [REF_FIELD_X_MIN_M]: bounds.xMin,
      [REF_FIELD_X_MAX_M]: bounds.xMax,
      [REF_FIELD_Y_MIN_M]: bounds.yMin,
      [REF_FIELD_Y_MAX_M]: bounds.yMax,
    },
  } as FacilityObject
}

const areaWith = (facilities: FacilityObject[]) => [
  { ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE), facilities },
]

describe('場域範圍對不上中心線', () => {
  const correct = { xMin: -1.675, xMax: 1.675, yMin: -101.675, yMax: 1.675 }

  it('差得比一個車道寬還多就照中心線重算', () => {
    // 往南多出 70 公尺：這種方框會把鄰居範圍內的點吸過去
    const f = track('D17', { ...correct, yMin: -171.675 })
    const out = repairTrackRefFieldBoundsInAreas(areaWith([f]))

    assert.equal(out.repaired.length, 1)
    assert.equal(out.repaired[0]!.name, 'D17')
    const b = getValidRefFieldBounds(out.areas[0]!.facilities[0]!.parameters)!
    assert.equal(b.yMinM, -101.67)
    assert.equal(b.yMaxM, 1.68)
  })

  it('只差半個車道的不動——那是撐開量的版本差異，不是錯誤', () => {
    // 不能用 0~0：那是「不參與定位」的占位值，會被當成沒有場域範圍
    const f = track('D16', { xMin: -1, xMax: 1, yMin: -100, yMax: 0 })
    const drift = refFieldBoundsDriftM(f)
    assert.ok(drift !== null && drift <= TRACK_REF_FIELD_BOUNDS_TOLERANCE_M)

    const out = repairTrackRefFieldBoundsInAreas(areaWith([f]))
    assert.equal(out.repaired.length, 0)
    assert.equal(out.areas[0]!.facilities[0], f)
  })

  it('沒有中心線的元件不碰', () => {
    const plain = {
      id: 'x',
      type: 'Facility',
      name: 'Facility',
      customName: 'M1',
      areaPosition: { x: 0, y: 0 },
      areaSizePx: { w: 10, h: 10 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Normal',
      parameters: {
        [REF_FIELD_X_MIN_M]: -900,
        [REF_FIELD_X_MAX_M]: -873,
        [REF_FIELD_Y_MIN_M]: -380,
        [REF_FIELD_Y_MAX_M]: -330,
      },
    } as FacilityObject

    assert.equal(refFieldBoundsDriftM(plain), null)
    const out = repairTrackRefFieldBoundsInAreas(areaWith([plain]))
    assert.equal(out.repaired.length, 0)
  })
})
