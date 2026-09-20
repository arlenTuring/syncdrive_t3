import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import '../../../i18n'
import { parseMapFileJson } from '../utils/mapFileJson'
import { FacilityRefFieldBoundsSection } from './FacilityRefFieldBoundsSection'

/*
 * react-dom/server 的型別會把 Node 的全域型別帶進整個專案；用非字面值的模組名稱載入，
 * 型別檢查就不會去解析它（同 TrackPartInspectorSection.cross.spec）。
 */
const serverModule = 'react-dom/' + 'server'
const { renderToStaticMarkup } = (await import(/* @vite-ignore */ serverModule)) as {
  renderToStaticMarkup: (node: unknown) => string
}

const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')
function load(): { creationMode?: string } | null {
  try {
    const active = JSON.parse(readFileSync(join(MAPS_DIR, 'active-map.json'), 'utf-8')) as { activeMapId: string }
    const file = join(MAPS_DIR, `${active.activeMapId}.json`)
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { mapDocument?: unknown }
    return (raw.mapDocument ?? raw) as { creationMode?: string }
  } catch {
    return null
  }
}
const doc = load()

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('場域範圍區塊：中心線過期提示', () => {
  const area = parseMapFileJson(doc as never).areas[0]!
  const render = (name: string) =>
    renderToStaticMarkup(
      createElement(FacilityRefFieldBoundsSection, {
        facility: area.facilities.find((f) => f.customName === name)!,
        area,
        readOnly: false,
        onPatchParameters: () => {},
        onFieldFocus: () => {},
        onFieldBlur: () => {},
      }),
    )

  it('正常的軌道只說明「範圍由中心線決定」，不顯示重建按鈕', () => {
    const html = render('U06')
    expect(html).toContain('這一塊有自己的現場中心線')
    expect(html).not.toContain('依接合的鄰居重建中心線')
  })

  it('U04 若還是複製來的舊中心線：顯示差距與重建按鈕（圖資已修好時不顯示）', () => {
    const html = render('U04')
    const stillStale = html.includes('中心線與圖上貼著它的軌道對不上')
    if (stillStale) expect(html).toContain('依接合的鄰居重建中心線')
    else expect(html).not.toContain('依接合的鄰居重建中心線')
  })
})
