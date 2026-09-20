import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import '../../../i18n'
import { TrackInspectorSection } from '../components/TrackInspectorSection'
import type { FacilityObject } from '../types/facility'
import { buildMapFileV2, parseMapFileJson } from './mapFileJson'
import { getTrackFillOpacity, TRACK_FILL_OPACITY_KEY, withFillOpacity } from './trackFacility'

/*
 * react-dom/server 的型別會把 Node 的全域型別帶進整個專案；用非字面值的模組名稱載入，
 * 型別檢查就不會去解析它（同 TrackPartInspectorSection.cross.spec）。
 */
const serverModule = 'react-dom/' + 'server'
const { renderToStaticMarkup } = (await import(/* @vite-ignore */ serverModule)) as {
  renderToStaticMarkup: (node: unknown) => string
}

function track(parameters: Record<string, unknown> = {}): FacilityObject {
  return { id: 't1', type: 'Track', name: 'Rail', customName: 'D01', parameters } as unknown as FacilityObject
}

describe('軌道填色透明度', () => {
  it('沒設就是不透明；設了照設；超出範圍夾到 0–1；不是數字視為不透明', () => {
    expect(getTrackFillOpacity(track())).toBe(1)
    expect(getTrackFillOpacity(track({ [TRACK_FILL_OPACITY_KEY]: 0.4 }))).toBe(0.4)
    expect(getTrackFillOpacity(track({ [TRACK_FILL_OPACITY_KEY]: 0 }))).toBe(0)
    expect(getTrackFillOpacity(track({ [TRACK_FILL_OPACITY_KEY]: 3 }))).toBe(1)
    expect(getTrackFillOpacity(track({ [TRACK_FILL_OPACITY_KEY]: -1 }))).toBe(0)
    expect(getTrackFillOpacity(track({ [TRACK_FILL_OPACITY_KEY]: 'x' }))).toBe(1)
  })

  it('不透明時填色原樣；透明時用 color-mix，對 hex、rgb、命名色都成立', () => {
    expect(withFillOpacity('#191F2F', 1)).toBe('#191F2F')
    expect(withFillOpacity('#191F2F', 0)).toBe('color-mix(in srgb, #191F2F 0%, transparent)')
    expect(withFillOpacity('rgb(1, 2, 3)', 0.35)).toBe('color-mix(in srgb, rgb(1, 2, 3) 35%, transparent)')
    expect(withFillOpacity('tomato', 0.5)).toBe('color-mix(in srgb, tomato 50%, transparent)')
  })

  it('屬性框有「軌道透明度」滑桿，顯示目前的百分比；唯讀時不能拖', () => {
    const props = {
      sizeMeters: { w: 10, h: 3 },
      onPatchParameters: () => {},
      onFieldFocus: () => {},
      onFieldBlur: () => {},
    }
    const html = renderToStaticMarkup(
      createElement(TrackInspectorSection, {
        facility: track({ [TRACK_FILL_OPACITY_KEY]: 0.4 }),
        readOnly: false,
        ...props,
      }),
    )
    expect(html).toContain('軌道透明度')
    expect(html).toContain('type="range"')
    expect(html).toContain('40%')
    const ro = renderToStaticMarkup(
      createElement(TrackInspectorSection, { facility: track(), readOnly: true, ...props }),
    )
    expect(ro).toContain('disabled')
    expect(ro).toContain('100%')
  })

  it('存檔再載入，透明度還在（不會在匯出／解析時被丟掉）', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '../../../../../backend/data/published-maps')
    if (!existsSync(join(dir, 'active-map.json'))) return
    const active = JSON.parse(readFileSync(join(dir, 'active-map.json'), 'utf-8')) as { activeMapId: string }
    const file = join(dir, `${active.activeMapId}.json`)
    if (!existsSync(file)) return
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { mapDocument?: unknown }
    const parsed = parseMapFileJson((raw.mapDocument ?? raw) as never)
    const target = parsed.areas[0]!.facilities.find((f) => f.type === 'Track' && f.name === 'Rail')!
    const areas = parsed.areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) =>
        f.id === target.id ? { ...f, parameters: { ...f.parameters, [TRACK_FILL_OPACITY_KEY]: 0.25 } } : f,
      ),
    }))
    const file2 = buildMapFileV2('m', 'm', parsed.pixelSize, areas)
    const again = parseMapFileJson(JSON.parse(JSON.stringify(file2)) as never)
    const back = again.areas[0]!.facilities.find((f) => f.id === target.id)!
    expect(getTrackFillOpacity(back)).toBe(0.25)
  })
})
