import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import '../../../i18n'
import type { FacilityObject } from '../types/facility'
import { TrackPartInspectorSection } from './TrackPartInspectorSection'

function cross(parameters: Record<string, unknown> = {}): FacilityObject {
  return {
    id: 'x1',
    type: 'Track',
    name: 'RailCross',
    customName: 'D03/U03',
    parameters,
  } as unknown as FacilityObject
}

/*
 * react-dom/server 的型別會把 Node 的全域型別帶進整個專案，讓別處的 setTimeout 回傳型別變成
 * NodeJS.Timeout；用非字面值的模組名稱載入，型別檢查就不會去解析它。
 */
const serverModule = 'react-dom/' + 'server'
const { renderToStaticMarkup } = (await import(/* @vite-ignore */ serverModule)) as {
  renderToStaticMarkup: (node: unknown) => string
}

describe('交叉軌道的分段命名屬性框', () => {
  const html = renderToStaticMarkup(
    createElement(TrackPartInspectorSection, {
      facility: cross({ trackGenPartNames: { up: 'D03', down: 'U03' } }),
      onPatchParameters: () => {},
    }),
  )

  it('四段各一列：上側、下側、左下右上側、右下左上側', () => {
    for (const label of ['上側', '下側', '左下右上側', '右下左上側']) {
      expect(html).toContain(label)
    }
    expect(html.match(/font-mono/g)?.length).toBeGreaterThanOrEqual(8)
  })

  it('不再有上行、下行的字樣', () => {
    expect(html).not.toContain('上行')
    expect(html).not.toContain('下行')
  })

  it('只有斜行兩列有「顯示名稱」開關', () => {
    expect(html.match(/顯示名稱/g)?.length).toBe(2)
    expect(html.match(/type="checkbox"/g)?.length).toBe(2)
  })
})
