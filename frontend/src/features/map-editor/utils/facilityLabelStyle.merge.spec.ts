import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeFacilityLabelStyle } from './facilityLabelStyle'

describe('名稱樣式合併：只改位置、字級時不洗掉顏色', () => {
  it('拖曳名稱（只帶 labelOffsetPx）保留使用者設定的顏色', () => {
    const next = mergeFacilityLabelStyle({ color: '#51A2FF', fontSizePx: 22 }, { labelOffsetPx: { x: 3, y: 4 }, labelOffsetCustom: true })
    assert.equal(next.color, '#51A2FF')
  })
  it('改字級、旋轉也保留顏色', () => {
    assert.equal(mergeFacilityLabelStyle({ color: '#51A2FF' }, { fontSizePx: 18 }).color, '#51A2FF')
    assert.equal(mergeFacilityLabelStyle({ color: '#51A2FF' }, { labelRotationDeg: 15 }).color, '#51A2FF')
  })
  it('明確清除顏色（"" 或 color: undefined）才刪', () => {
    assert.equal(mergeFacilityLabelStyle({ color: '#51A2FF' }, { color: '' }).color, undefined)
    assert.equal(mergeFacilityLabelStyle({ color: '#51A2FF' }, { color: undefined }).color, undefined)
  })
})
