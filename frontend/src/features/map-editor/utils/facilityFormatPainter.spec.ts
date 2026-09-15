import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  applyFacilityFormat,
  extractFacilityFormat,
} from './facilityFormatPainter'
import {
  REF_FIELD_X_MAX_M,
  REF_FIELD_X_MIN_M,
  REF_FIELD_Y_MAX_M,
  REF_FIELD_Y_MIN_M,
} from './facilityRefFieldBounds'

function track(
  id: string,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  extra: Record<string, unknown> = {},
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
      [REF_FIELD_X_MIN_M]: bounds.xMin,
      [REF_FIELD_X_MAX_M]: bounds.xMax,
      [REF_FIELD_Y_MIN_M]: bounds.yMin,
      [REF_FIELD_Y_MAX_M]: bounds.yMax,
      ...extra,
    },
  } as FacilityObject
}

describe('複製格式', () => {
  const area = createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE)

  it('不把來源的場域範圍貼到目標身上', () => {
    const source = track('src', { xMin: -900, xMax: -873, yMin: -380, yMax: -330 }, {
      defaultFillColor: '#ff0000',
    })
    const target = track('dst', { xMin: -300, xMax: -250, yMin: -10, yMax: 10 })

    const snapshot = extractFacilityFormat(source, area.domain, area.layout)
    const next = applyFacilityFormat(target, snapshot, area.domain, area.layout)
    const params = next.parameters ?? {}

    // 場域範圍是「這一塊代表現場的哪一段」，圖台↔場域換算全靠它，不能跟著格式走
    assert.equal(params[REF_FIELD_X_MIN_M], -300)
    assert.equal(params[REF_FIELD_X_MAX_M], -250)
    assert.equal(params[REF_FIELD_Y_MIN_M], -10)
    assert.equal(params[REF_FIELD_Y_MAX_M], 10)
    // 快照裡根本不該有這四個欄位
    for (const key of [
      REF_FIELD_X_MIN_M,
      REF_FIELD_X_MAX_M,
      REF_FIELD_Y_MIN_M,
      REF_FIELD_Y_MAX_M,
    ]) {
      assert.equal(snapshot.parameters[key], undefined)
    }
  })

  it('該複製的長相還是有複製', () => {
    const source = track('src', { xMin: -900, xMax: -873, yMin: -380, yMax: -330 }, {
      defaultFillColor: '#00ff00',
      strokeWidthPx: 3,
      strokeColor: '#123456',
      strokeStyle: 'dashed',
    })
    source.rotation = 90
    source.areaSizePx = { w: 250, h: 40 }
    const target = track('dst', { xMin: -300, xMax: -250, yMin: -10, yMax: 10 })

    const snapshot = extractFacilityFormat(source, area.domain, area.layout)
    const next = applyFacilityFormat(target, snapshot, area.domain, area.layout)
    const params = next.parameters ?? {}

    assert.equal(params.defaultFillColor, '#00ff00')
    assert.equal(params.strokeWidthPx, 3)
    assert.equal(params.strokeColor, '#123456')
    assert.equal(params.strokeStyle, 'dashed')
    assert.equal(next.rotation, 90)
    assert.deepEqual(next.areaSizePx, snapshot.canvasSizePx)
  })

  it('目標本來沒有場域範圍，貼完也不會憑空多出來', () => {
    const source = track('src', { xMin: -900, xMax: -873, yMin: -380, yMax: -330 })
    const bare: FacilityObject = {
      ...track('dst', { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }),
      parameters: { defaultFillColor: '#111111' },
    }

    const snapshot = extractFacilityFormat(source, area.domain, area.layout)
    const next = applyFacilityFormat(bare, snapshot, area.domain, area.layout)
    const params = next.parameters ?? {}

    assert.equal(params[REF_FIELD_X_MIN_M], undefined)
    assert.equal(params[REF_FIELD_Y_MAX_M], undefined)
  })
})
