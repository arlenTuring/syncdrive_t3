import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { withCrossBranchTracks } from '../utils/crossBranches'
import { parseMapFileJson } from '../utils/mapFileJson'
import { getTrackGenPaths, pointAlongPath } from '../utils/trackGenPaths'
import { getTrackNetwork } from './trackNetwork'
import { drawnRotateWithSwingDeg } from './resolveVehicleTrackPlacement'

/**
 * 換塊補間：畫的位置還在上一塊、定位點（車頭讀值）已經在下一塊的那一小段時間，車頭不能翻。
 *
 * 以前決定「車頭朝前還是朝後」拿的是定位點那一塊的切線；兩塊的中心線記錄順序不一定同向
 * （D16 由西往東記、接著的 D17 由接點往西南記），上一塊的方向就被判反，車頭轉 174 度，
 * 以後軸為軸心整台翻到後面：看起來是倒退一下再回來（D16 → D17，80.3%→80.7% 那兩點）。
 *
 * 這裡掃整張圖：每一對相接的軌道、兩個行進方向，補間前半段的車頭與補間後半段的車頭
 * 差不能超過 60 度（彎道本身的轉角在接點那一點算不出這麼大的差）。
 */
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

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('換塊補間時車頭不翻', () => {
  it('相接的兩塊，補間前半（畫在上一塊、定位點在下一塊）與補間後半的車頭差 < 60 度', () => {
    const areas = withCrossBranchTracks(parseMapFileJson(doc as never).areas)
    const area = areas[0]!
    const index = getTrackNetwork(areas).genIndex!
    const byId = new Map(area.facilities.map((f) => [f.id, f]))
    const bad: string[] = []
    let checked = 0
    for (const [fromId, joins] of index.joins) {
      const from = byId.get(fromId.split('~')[0]!)
      const fromPaths = from ? getTrackGenPaths(from.parameters) : null
      if (!from || !fromPaths || fromId.includes('~')) continue
      for (const j of joins) {
        const to = byId.get(j.to.split('~')[0]!)
        const toPaths = to ? getTrackGenPaths(to.parameters) : null
        if (!to || !toPaths || j.to.includes('~')) continue
        const exitEnd = j.end
        const aAlong = exitEnd === 0 ? 0.02 : 0.98
        const bAlong = j.toEnd === 0 ? 0.02 : 0.98
        // 行進方向：從上一塊的接點附近走進下一塊
        const p0 = pointAlongPath(fromPaths.real, exitEnd === 0 ? 0.05 : 0.95)
        const p1 = pointAlongPath(toPaths.real, j.toEnd === 0 ? 0.05 : 0.95)
        const heading = Math.atan2(p1.y - p0.y, p1.x - p0.x)
        const at = pointAlongPath(toPaths.real, bAlong)
        const ref = { track: to, along: bAlong }
        const early = drawnRotateWithSwingDeg(from, area, at.x, at.y, heading, aAlong, ref)
        const late = drawnRotateWithSwingDeg(to, area, at.x, at.y, heading, bAlong, ref)
        if (early == null || late == null) continue
        let diff = Math.abs(early - late) % 360
        if (diff > 180) diff = 360 - diff
        checked += 1
        if (diff > 60) bad.push(`${from.customName}→${to.customName} ${diff.toFixed(0)}°`)
      }
    }
    expect(checked).toBeGreaterThan(20)
    expect(bad).toEqual([])
  })
})
