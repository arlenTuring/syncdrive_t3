import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseMapFileJson } from './mapFileJson'
import { getTrackGenPaths } from './trackGenPaths'
import { getTrackEnds, settleTrackJointsInAreas, validateTrackJoints } from './trackJoints'

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

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('軌道接點（真實圖資）', () => {
  const areas = parseMapFileJson(doc as never).areas
  const area = areas[0]!

  it('讀檔後產生接點，結構檢查無異常', () => {
    expect((area.trackJoints ?? []).length).toBeGreaterThan(10)
    const issues = validateTrackJoints(area)
    expect(issues.filter((i) => i.kind !== 'lonely')).toEqual([])
  })

  it('每個接點至少兩塊軌道，中心線端點與接點一致', () => {
    for (const j of area.trackJoints ?? []) {
      const members = area.facilities.filter((f) => Object.values(getTrackEnds(f.parameters)).includes(j.id))
      expect(members.length).toBeGreaterThanOrEqual(2)
      for (const f of members) {
        if (f.name === 'RailCross') continue
        const ends = getTrackEnds(f.parameters)
        const paths = getTrackGenPaths(f.parameters)!
        const p = ends.start === j.id ? paths.real[0]! : paths.real[paths.real.length - 1]!
        expect(Math.hypot(p[0] - j.xM, p[1] - j.yM)).toBeLessThan(0.01)
      }
    }
  })

  it('再整理一次不會變（冪等）', () => {
    const again = settleTrackJointsInAreas(areas)
    expect(again.created).toBe(0)
    expect(again.dropped).toBe(0)
    expect(again.moved).toBe(0)
  })

  it('存檔再讀回，接點與綁定不變', () => {
    const json = JSON.stringify(area.trackJoints)
    const ends = area.facilities.map((f) => JSON.stringify(getTrackEnds(f.parameters)))
    const again = settleTrackJointsInAreas(areas).areas[0]!
    expect(JSON.stringify(again.trackJoints)).toBe(json)
    expect(again.facilities.map((f) => JSON.stringify(getTrackEnds(f.parameters)))).toEqual(ends)
  })

  const plain = area.facilities.find(
    (f) => f.type === 'Track' && f.name === 'Rail' && Object.keys(getTrackEnds(f.parameters)).length === 2,
  )!

  it('刪掉一塊軌道：只剩一塊的接點放掉，鄰居的綁定一併清掉', () => {
    const ends = Object.values(getTrackEnds(plain.parameters))
    const cut = { ...area, facilities: area.facilities.filter((f) => f.id !== plain.id) }
    const out = settleTrackJointsInAreas([cut]).areas[0]!
    expect(validateTrackJoints(out).filter((i) => i.kind !== 'lonely')).toEqual([])
    for (const id of ends) {
      const users = out.facilities.filter((f) => Object.values(getTrackEnds(f.parameters)).includes(id))
      // 還有兩塊以上的（例如交叉口）才會留下；否則整個接點都不在
      expect(users.length === 0 || users.length >= 2).toBe(true)
    }
  })

  it('把軌道拖離接點很遠：放掉綁定，不會把別塊拉過去', () => {
    const before = plain.areaPosition!
    const moved = {
      ...area,
      facilities: area.facilities.map((f) =>
        f.id === plain.id ? { ...f, areaPosition: { x: before.x + 400, y: before.y + 300 } } : f,
      ),
    }
    const out = settleTrackJointsInAreas([moved]).areas[0]!
    const after = out.facilities.find((f) => f.id === plain.id)!
    expect(Object.keys(getTrackEnds(after.parameters)).length).toBeLessThan(2)
  })

  it('複製貼上：綁定不跟著走', async () => {
    const { stripTrackGenIdentity } = await import('./trackGenIdentity')
    expect(getTrackEnds(stripTrackGenIdentity(plain.parameters))).toEqual({})
  })
})
