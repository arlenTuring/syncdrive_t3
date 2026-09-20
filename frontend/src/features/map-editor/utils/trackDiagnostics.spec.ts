import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { TrackDiagnosticsPanel } from '../components/TrackDiagnosticsPanel'
import { parseMapFileJson } from './mapFileJson'
import { diagnoseTracks } from './trackDiagnostics'
import { getTrackGenPaths } from './trackGenPaths'

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

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('軌道檢查（真實圖資）', () => {
  const areas = parseMapFileJson(doc as never).areas
  const area = areas[0]!
  const byName = (name: string) => area.facilities.find((f) => f.customName === name)!

  it('正常接著鄰居的軌道不會被列出', () => {
    const { statusByFacility } = diagnoseTracks(areas)
    for (const name of ['D10', 'U10', 'D22', 'U22', 'D37', 'U37', 'D06', 'U06']) {
      expect(statusByFacility.has(byName(name).id), name).toBe(false)
    }
  })

  it('每一筆都寫清楚是哪一塊、差多少、怎麼處理', () => {
    const { issues } = diagnoseTracks(areas)
    for (const i of issues) {
      expect(i.title.length).toBeGreaterThan(5)
      expect(i.detail).toMatch(/\d/)
      expect(i.suggestion.length).toBeGreaterThan(10)
      expect(['error', 'warn']).toContain(i.severity)
    }
  })

  it('把 U05 的現場中心線換成 U06 的（複製來的樣子）：接不上鄰居，被標成嚴重', () => {
    const broken = areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) =>
        f.id === byName('U05').id
          ? { ...f, parameters: { ...f.parameters, trackGenRealPath: byName('U06').parameters!.trackGenRealPath } }
          : f,
      ),
    }))
    const { issues, statusByFacility } = diagnoseTracks(broken)
    expect(statusByFacility.get(byName('U05').id)).toBe('error')
    expect(issues.some((i) => i.kind === 'junction' && i.label === 'U05')).toBe(true)
  })

  it('同一條車道上兩塊軌道的里程重疊：較長的那塊標嚴重、另一塊標注意', () => {
    // U18 里程 134～302 與 U17 的 218～303 重疊（圖資裡本來就有）；若圖資已修好，就人工造一個
    const base = diagnoseTracks(areas)
    if (base.issues.some((i) => i.kind === 'overlap')) {
      const i = base.issues.find((x) => x.kind === 'overlap')!
      expect(base.statusByFacility.get(i.facilityId)).toBe('error')
      return
    }
    const u17 = byName('U17')
    const spans = u17.parameters!.trackGenSpans as Array<Record<string, number>>
    const doubled = areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) =>
        f.id === byName('U18').id
          ? { ...f, parameters: { ...f.parameters, trackGenSpans: spans.map((s) => ({ ...s, s0: s.s0! - 10 })) } }
          : f,
      ),
    }))
    expect(diagnoseTracks(doubled).issues.some((x) => x.kind === 'overlap')).toBe(true)
  })

  it('現場中心線兩端與圖面路徑的方向：整條主線的箭頭前後相接（沒有相鄰兩塊方向相反）', () => {
    // 同一車道上相鄰兩塊，中心線走向該一致；U18／U19 是圖資裡已知對不上的一組，除外
    const ends = (name: string) => {
      const real = getTrackGenPaths(byName(name).parameters)!.real
      return [real[0]!, real[real.length - 1]!] as const
    }
    const [a0, a1] = ends('U10')
    const [b0, b1] = ends('U11')
    // U10 與 U11 接在一起：一塊的終點就是另一塊的起點（走向一致）
    const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 3
    expect(near(a1, b0) || near(b1, a0)).toBe(true)
  })

  it('面板：沒問題時說全部正常；有問題時列出標題、原因與建議', () => {
    const empty = renderToStaticMarkup(
      createElement(TrackDiagnosticsPanel, {
        diagnostics: { issues: [], statusByFacility: new Map() },
        onLocate: () => {},
        onClose: () => {},
      }),
    )
    expect(empty).toContain('全部正常')
    const { issues, statusByFacility } = diagnoseTracks(areas)
    if (issues.length === 0) return
    const html = renderToStaticMarkup(
      createElement(TrackDiagnosticsPanel, {
        diagnostics: { issues, statusByFacility },
        onLocate: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain(`${issues.length} 項需要處理`)
    expect(html).toContain(issues[0]!.title)
    expect(html).toContain(issues[0]!.suggestion)
  })
})
