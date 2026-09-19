import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getTrackNetwork } from '../vehicles/trackNetwork'
import {
  buildTrackNetwork,
  previousTrackIdOf,
  resolveVehiclePlacementAcrossAreas,
} from '../vehicles/resolveVehicleTrackPlacement'
import {
  CROSS_BRANCH_ID_SEPARATOR,
  deriveCrossBranches,
  parentFacilityIdOfBranch,
  withCrossBranchTracks,
} from './crossBranches'
import { resolveCrossPortalFields } from './crossTrackPortals'
import { parseMapFileJson } from './mapFileJson'
import { tracksAreConnected } from './trackGenLocate'
import { backfillTrackGenSpansInAreas } from './trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from './trackRefFieldBoundsRepair'

/**
 * 交叉軌道分支：用真實發布的圖資驗。圖資不在 git 裡，沒有就跳過。
 *
 * 四個口的座標對照 T3 站點目錄（document/release-20260918/T3-map-catalog.json）——那是
 * 車端／模擬器實際使用的途經點座標。
 */
const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')

function loadActiveMap(): { creationMode?: string } | null {
  try {
    const active = JSON.parse(readFileSync(join(MAPS_DIR, 'active-map.json'), 'utf-8')) as {
      activeMapId: string
    }
    const file = join(MAPS_DIR, `${active.activeMapId}.json`)
    if (!existsSync(file)) return null
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { mapDocument?: unknown }
    return (raw.mapDocument ?? raw) as { creationMode?: string }
  } catch {
    return null
  }
}

const inner = loadActiveMap()

describe.skipIf(!inner || inner.creationMode !== 'trackGen')('交叉軌道分支（真實圖資）', () => {
  const areas = repairTrackRefFieldBoundsInAreas(
    backfillTrackGenSpansInAreas(parseMapFileJson(inner as never).areas).areas,
  ).areas
  const findCross = (code: string) => {
    for (const area of areas) {
      for (const f of area.facilities ?? []) {
        if (f.name === 'RailCross' && f.customName === code) return { f, area }
      }
    }
    throw new Error(`圖上沒有 ${code}`)
  }

  it('四個口取隔壁軌道的端點，與站點目錄的途經點座標一致', () => {
    const near = (a: number | null, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(0.05)
    const c72 = findCross('D03/U03')
    const p72 = resolveCrossPortalFields(c72.f, c72.area)
    near(p72.lt.xM, -112.89)
    near(p72.lt.yM, -14.7)
    near(p72.rt.xM, -68.03)
    near(p72.rt.yM, -0.96)
    near(p72.rb.xM, -67.15)
    near(p72.rb.yM, -8.52)
    const c99 = findCross('D35/U35')
    const p99 = resolveCrossPortalFields(c99.f, c99.area)
    for (const [key, x, y] of [
      ['lt', -180.83, -330.5],
      ['lb', -180.97, -333.99],
      ['rt', -135.15, -331.35],
      ['rb', -135.18, -334.85],
    ] as const) {
      near(p99[key].xM, x)
      near(p99[key].yM, y)
    }
  })

  it('D03/U03：diagUp 由 lb 往 rt、diagDown 由 rb 往 lt，各自一條中心線', () => {
    const { f, area } = findCross('D03/U03')
    const byCode = new Map(deriveCrossBranches(f, area).map((b) => [b.code, b]))
    const up = byCode.get('D03U03_DIAG_UP')!
    const down = byCode.get('D03U03_DIAG_DOWN')!
    expect(up.from).toBe('lb')
    expect(up.to).toBe('rt')
    expect(down.from).toBe('rb')
    expect(down.to).toBe('lt')
    // 兩條斜線在外側差好幾公尺——這正是原本單一中線被拿去代表兩條的落差
    const upStart = up.real[0]!
    const downEnd = down.real[1]!
    expect(Math.hypot(upStart[0] - downEnd[0], upStart[1] - downEnd[1])).toBeGreaterThan(2)
    // 直行兩條關著，不產生分支
    expect(byCode.size).toBe(2)
    expect(up.facilityId).toBe(`${f.id}${CROSS_BRANCH_ID_SEPARATOR}DIAG_UP`)
    expect(parentFacilityIdOfBranch(up.facilityId)).toBe(f.id)
  })

  it('同一份區域只推導一次，且沒有交叉軌道時原樣回傳', () => {
    expect(withCrossBranchTracks(areas)).toBe(withCrossBranchTracks(areas))
    const none = [{ ...areas[0]!, facilities: (areas[0]!.facilities ?? []).filter((f) => f.name !== 'RailCross') }]
    expect(withCrossBranchTracks(none)).toBe(none)
  })

  it('斜線上的車判給那一條分支，偏移量近乎 0；改用單一中線會差好幾公尺', () => {
    const { f, area } = findCross('D03/U03')
    const derived = withCrossBranchTracks(areas)
    const network = getTrackNetwork(derived)
    for (const b of deriveCrossBranches(f, area)) {
      const [[x0, y0], [x1, y1]] = b.real as [[number, number], [number, number]]
      const heading = Math.atan2(y1 - y0, x1 - x0)
      // 分支三成處：交叉的兩條斜線在中段最接近，取偏一點的位置才分得出來
      const x = x0 + (x1 - x0) * 0.3
      const y = y0 + (y1 - y0) * 0.3
      const hit = resolveVehiclePlacementAcrossAreas(derived, x, y, network, {
        headingRad: heading,
        speedMps: 5,
      })
      expect(hit?.placement.trackId).toBe(b.facilityId)
      expect(Math.abs(hit?.placement.network?.offsetM ?? NaN)).toBeLessThan(0.05)
    }
  })

  it('分支的端點接上隔壁軌道，換塊判定與補間能沿路接起來', () => {
    const { f, area } = findCross('D35/U35')
    const derived = withCrossBranchTracks(areas)
    const index = getTrackNetwork(derived).genIndex!
    const up = deriveCrossBranches(f, area).find((b) => b.code === 'D35U35_DIAG_UP')!
    const neighbours = (index.joins.get(up.facilityId) ?? []).map((j) => j.to)
    expect(neighbours.length).toBeGreaterThanOrEqual(2)
    for (const n of neighbours) expect(tracksAreConnected(index, up.facilityId, n)).toBe(true)
  })

  /*
   * 重播：模擬器沿「圖台畫的營運路線」走過兩塊交叉軌道時每一點的座標與行進方向
   * （__fixtures__/route-through-cross.json，從模擬器路線取樣）。
   * 單一中線時，走斜線的路線離中線最多 6.97 公尺；拆成分支後每條路線都明顯縮小。
   */
  describe('沿營運路線重播', () => {
    type Route = { route: string; zone: string; points: Array<{ x: number; y: number; heading: number }> }
    const routes = JSON.parse(
      readFileSync(join(__dirname, '../vehicles/__fixtures__/route-through-cross.json'), 'utf-8'),
    ) as Route[]

    function crossMaxOffset(mapAreas: typeof areas, route: Route) {
      const network = buildTrackNetwork(mapAreas)
      const isCross = new Map<string, boolean>()
      for (const area of mapAreas) {
        for (const f of area.facilities ?? []) isCross.set(f.id, f.name === 'RailCross')
      }
      let previous: string | undefined
      let max = 0
      let placed = 0
      for (const p of route.points) {
        const hit = resolveVehiclePlacementAcrossAreas(mapAreas, p.x, p.y, network, {
          headingRad: p.heading,
          speedMps: 5,
          previousTrackId: previous,
        })
        previous = previousTrackIdOf(hit, false)
        if (hit) placed += 1
        if (hit && isCross.get(hit.placement.trackId)) {
          max = Math.max(max, Math.abs(hit.placement.network?.offsetM ?? 0))
        }
      }
      return { max, placed }
    }

    it('每一點都定得到位，走斜線的路線離中心線的最大偏移縮小', () => {
      const derived = withCrossBranchTracks(areas)
      let improved = 0
      for (const route of routes) {
        const before = crossMaxOffset(areas, route)
        const after = crossMaxOffset(derived, route)
        expect(after.placed, route.route).toBe(route.points.length)
        // 沒有任何一條路線變差（容許 0.05 公尺的數值誤差）
        expect(after.max, route.route).toBeLessThanOrEqual(before.max + 0.05)
        if (after.max < before.max - 1) improved += 1
      }
      // 至少一半的路線改善超過 1 公尺
      expect(improved).toBeGreaterThanOrEqual(Math.ceil(routes.length / 2))
    })

    it('拆分支後整體最大偏移不超過 3.5 公尺（單一中線時是 6.97）', () => {
      const derived = withCrossBranchTracks(areas)
      for (const route of routes) expect(crossMaxOffset(derived, route).max, route.route).toBeLessThan(3.5)
    })
  })
})
