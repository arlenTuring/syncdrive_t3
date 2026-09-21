import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { withCrossBranchTracks } from '../utils/crossBranches'
import { parseMapFileJson } from '../utils/mapFileJson'
import { getTrackNetwork } from './trackNetwork'
import { buildRouteCorridors } from './routeCorridor'
import { previousTrackIdOf, resolveVehiclePlacementAcrossAreas } from './resolveVehicleTrackPlacement'

/**
 * 車沿著每一條路線開，畫面上會不會「往前走又倒退」。
 *
 * <h3>怎麼知道</h3>
 * 不必等人盯著畫面：把模擬器算出的每條路線取樣點（車實際會回報的場域座標）逐點丟進圖台的定位，
 * 看<strong>畫面座標</strong>的軌跡——
 * <ul>
 *   <li>折返：相鄰兩步的畫面位移夾角超過 150 度（畫面上先前進又退回去）。</li>
 *   <li>跳格：一步位移遠超過該有的長度（在疊在一起的兩塊軌道之間跳來跳去）。</li>
 * </ul>
 * 場域座標是一路往前的，畫面卻倒退，就是定位（判給哪一塊軌道）出了問題，例如 D20 與 T03 交叉處。
 *
 * 樣本是模擬器 <code>buildRoutes</code> 的輸出（14 條路線、2392 點）；路線改了要重新匯出：
 * <pre>node -e "…buildRoutes… samples → __fixtures__/all-route-samples.json"</pre>
 * 圖資不在 git 裡，沒有就跳過。
 */
const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')
const FIXTURE = join(__dirname, '__fixtures__/all-route-samples.json')

function loadDoc(): { creationMode?: string; routes?: Array<{ displayName: string; stationIds: string[] }> } | null {
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
const doc = loadDoc()

type Sample = { x: number; y: number; heading: number }
type RouteFixture = { route: string; stationIds: string[]; points: Sample[] }

describe.skipIf(!doc || doc.creationMode !== 'trackGen' || !existsSync(FIXTURE))('沿路線開：畫面上不折返、不跳格', () => {
  const areas = parseMapFileJson(doc as never).areas
  const derived = withCrossBranchTracks(areas)
  const network = getTrackNetwork(derived)
  const fixtures = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as RouteFixture[]
  const nameOf = (id: string) => {
    const [base, branch] = id.split('~')
    const f = derived[0]!.facilities.find((x) => x.id === base)
    return `${f?.customName || base}${branch ? `~${branch}` : ''}`
  }

  function drive(route: RouteFixture, useCorridor: boolean) {
    const corridors = useCorridor
      ? buildRouteCorridors(derived, [{ stationIds: route.stationIds }], network.genIndex)
      : null
    const target = route.stationIds[route.stationIds.length - 1]!
    const corridor = corridors?.byTargetStation.get(target)
    let previous: string | undefined
    const frames: Array<{ x: number; y: number; track: string }> = []
    for (const p of route.points) {
      const hit = resolveVehiclePlacementAcrossAreas(derived, p.x, p.y, network, {
        headingRad: p.heading,
        speedMps: 5,
        previousTrackId: previous,
        corridorFacilityIds: corridor,
      })
      previous = previousTrackIdOf(hit, false)
      if (!hit) continue
      frames.push({ x: hit.placement.areaLocalX, y: hit.placement.areaLocalY, track: nameOf(hit.placement.trackId) })
    }
    return frames
  }

  /** 折返與跳格。步長中位數當基準：圖上每個樣本間距大致固定 */
  function findProblems(frames: Array<{ x: number; y: number; track: string }>) {
    const steps = frames.slice(1).map((f, i) => ({ dx: f.x - frames[i]!.x, dy: f.y - frames[i]!.y, at: i + 1 }))
    const lens = steps.map((s) => Math.hypot(s.dx, s.dy)).filter((l) => l > 0.5).sort((a, b) => a - b)
    const median = lens[Math.floor(lens.length / 2)] ?? 1
    const problems: string[] = []
    for (let i = 1; i < steps.length; i += 1) {
      const a = steps[i - 1]!
      const b = steps[i]!
      const la = Math.hypot(a.dx, a.dy)
      const lb = Math.hypot(b.dx, b.dy)
      if (la > 8 && lb > 8 && (a.dx * b.dx + a.dy * b.dy) / (la * lb) < -0.87) {
        problems.push(`折返@${b.at}(${frames[b.at]!.track})`)
      } else if (lb > median * 4 && lb > 25) {
        problems.push(`跳格@${b.at}(${frames[b.at - 1]!.track}→${frames[b.at]!.track}，${lb.toFixed(0)}px)`)
      }
    }
    return problems
  }

  /*
   * 進出分區的接駁路線（整備調度區、充電洗車區）：起訖是分區入口的途經點，站在軌道端點上，路徑是站點之間的
   * 近似線，經過 D20／T02／T03、交叉口那些疊在一起的地方。沒有走廊時只剩車頭朝向決定判給哪一塊，車會在
   * 相鄰車道之間來回換；有走廊（途經點也當站解析）就沿著該走的那幾塊。所以這幾條只驗「有走廊」。
   */
  const isZoneLink = (r: RouteFixture) => /整備調度區|充電洗車區/.test(r.route)

  it('正線路線沒有走廊也連續', () => {
    const report: Record<string, string[]> = {}
    for (const route of fixtures.filter((r) => !isZoneLink(r))) {
      const problems = findProblems(drive(route, false))
      if (problems.length > 0) report[route.route] = problems.slice(0, 6)
    }
    expect(report).toEqual({})
  })

  it('所有路線（含進出分區的接駁）有走廊時每一條都連續', () => {
    const report: Record<string, string[]> = {}
    for (const route of fixtures) {
      const problems = findProblems(drive(route, true))
      if (problems.length > 0) report[route.route] = problems.slice(0, 6)
    }
    expect(report).toEqual({})
  })
})
