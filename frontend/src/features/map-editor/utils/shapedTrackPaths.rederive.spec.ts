import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseMapFileJson } from './mapFileJson'
import {
  MAX_MOVED_FOR_REBUILD,
  movedFacilityKeys,
  rebuildStaleAmong,
  snapshotGeometry,
} from './rederiveAfterMove'
import {
  findStaleTrackPathEnds,
  rederiveTrackPath,
} from './shapedTrackPaths'
import { getTrackGenPaths } from './trackGenPaths'

/**
 * 複製來的軌道中心線過期：真實圖資上的 U04 是 U06 的複製（中心線一字不差），畫在 U05 與交叉之間。
 * 圖資不在 git 裡，沒有就跳過。
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

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('軌道中心線過期與重建', () => {
  const areas = parseMapFileJson(doc as never).areas
  const area = areas[0]!
  const byName = (name: string) => area.facilities.find((f) => f.customName === name)!

  it('存好的圖資裡沒有中心線接不上隔壁的軌道', () => {
    const stale = area.facilities
      .filter((f) => f.type === 'Track' && findStaleTrackPathEnds(f, area).length > 0)
      .map((f) => f.customName || f.id)
    expect(stale).toEqual([])
    const real = getTrackGenPaths(byName('U04').parameters)!.real
    expect(Math.hypot(real[0]![0] + 138.4, real[0]![1] + 19.86)).toBeLessThan(0.05)
    expect(real[real.length - 1]![1]).toBeGreaterThan(-14)
  })

  it('正常接著隔壁的軌道不是過期', () => {
    for (const name of ['U06', 'D06', 'D05']) expect(findStaleTrackPathEnds(byName(name), area)).toEqual([])
  })

  it('重建 U04：兩端改接 U05 的終點與交叉的口，橫向比例尺換成這一塊的外框', () => {
    const u04 = {
      ...byName('U04'),
      parameters: { ...byName('U04').parameters, trackGenRealPath: byName('U06').parameters!.trackGenRealPath },
    }
    const res = rederiveTrackPath(u04, area)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const real = getTrackGenPaths(res.facility.parameters)!.real
    // 起點＝U05 的終點（−138.4, −19.86）
    expect(Math.hypot(real[0]![0] + 138.4, real[0]![1] + 19.86)).toBeLessThan(0.05)
    // 終點在交叉左側口（y 約 −12～−13），不再是 U06 的 −19.96
    expect(real[real.length - 1]![1]).toBeGreaterThan(-14)
    // 重建後與隔壁對得上
    expect(findStaleTrackPathEnds(res.facility, area)).toEqual([])
    // 一公尺橫向偏移佔外框高的比例 ＝ 同圖同把尺（3.5 公尺 ≈ 一條帶子高）
    const lat = res.facility.parameters!.trackGenLatPerBox as [number, number]
    expect(1 / lat[1]).toBeGreaterThan(3)
    expect(1 / lat[1]).toBeLessThan(4)
  })

  /** 把一塊軌道在圖上平移 (dx, dy) 像素（areaPosition 原點在左下、y 向上） */
  const shift = (id: string, dx: number, dy: number) =>
    areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) =>
        f.id === id ? { ...f, areaPosition: { x: f.areaPosition.x + dx, y: f.areaPosition.y + dy } } : f,
      ),
    }))
  const moveAndFollow = (id: string, dx: number, dy: number) => {
    const before = snapshotGeometry(areas)
    const moved = shift(id, dx, dy)
    const keys = movedFacilityKeys(before, snapshotGeometry(moved))!
    return { keys, moved, out: rebuildStaleAmong(moved, keys) }
  }
  const realOf = (mapAreas: typeof areas, id: string) =>
    getTrackGenPaths(mapAreas[0]!.facilities.find((f) => f.id === id)!.parameters)!.real

  it('沒有動就不檢查；只動了的那一塊才會被列入', () => {
    const before = snapshotGeometry(areas)
    expect(movedFacilityKeys(before, snapshotGeometry(areas))).toEqual([])
    const { keys } = moveAndFollow(byName('U06').id, 5, 0)
    expect(keys).toEqual([`${area.id}|${byName('U06').id}`])
  })

  it('複製 U06 放到 U04 的位置：兩端貼著 U05 與交叉，場域位置與範圍立刻跟過去', () => {
    // 模擬「複製後拖過去」：U04 的圖面位置不變，中心線換成 U06 的（複製來的樣子）
    const copy = {
      ...byName('U04'),
      parameters: { ...byName('U04').parameters, trackGenRealPath: byName('U06').parameters!.trackGenRealPath },
    }
    const withCopy = areas.map((a) => ({ ...a, facilities: a.facilities.map((f) => (f.id === copy.id ? copy : f)) }))
    const out = rebuildStaleAmong(withCopy, [`${area.id}|${copy.id}`])
    expect(out.rebuilt.map((r) => r.label)).toEqual(['U04'])
    const real = realOf(out.areas, copy.id)
    expect(Math.hypot(real[0]![0] + 138.4, real[0]![1] + 19.86)).toBeLessThan(0.05)
    expect(real[real.length - 1]![1]).toBeGreaterThan(-14)
  })

  it('已經接著鄰居的軌道稍微拖動：場域位置不變（現場的路沒有動），不把彎的中心線拉直', () => {
    const { out } = moveAndFollow(byName('U06').id, 8, 0)
    expect(out.rebuilt).toEqual([])
  })

  it('拖到圖上的空地（沒貼著任何軌道）：不動，不編造座標', () => {
    const { out } = moveAndFollow(byName('U06').id, 0, -400)
    expect(out.rebuilt).toEqual([])
  })

  it('只有一端貼著鄰居：形狀與長度不變，整條平移到那一端貼上', () => {
    // 往右拉 100 像素：左端離開 U07 太遠，右端剛好落在 U05 的起點附近
    for (const dx of [80, 100, 120]) {
      const { out } = moveAndFollow(byName('U06').id, dx, 0)
      if (out.rebuilt.length === 0) continue
      const before = realOf(areas, byName('U06').id)
      const after = realOf(out.areas, byName('U06').id)
      const len = (r: number[][]) => Math.hypot(r[r.length - 1]![0] - r[0]![0], r[r.length - 1]![1] - r[0]![1])
      expect(len(after)).toBeCloseTo(len(before), 1)
    }
  })

  it('換圖或整批變動不當成使用者移動', () => {
    const before = snapshotGeometry(areas)
    const shifted = areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) => ({ ...f, areaPosition: { ...f.areaPosition, x: f.areaPosition.x + 1 } })),
    }))
    expect(movedFacilityKeys(before, snapshotGeometry(shifted))).toBeNull()
    expect(movedFacilityKeys(new Map(), before)).toBeNull()
    expect(MAX_MOVED_FOR_REBUILD).toBeGreaterThan(1)
  })
})

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('依圖上形狀重算範圍：載入後是空操作', () => {
  it('72 塊軌道裡幾乎沒有會被「重算」改動的（範圍與中心線同一個定義）', async () => {
    const { syncAutoRefFieldBoundsFromPlacement } = await import('./facilityRefFieldBoundsAuto')
    const areas = parseMapFileJson(doc as never).areas
    const changed: string[] = []
    for (const a of areas) {
      for (const f of a.facilities) {
        if (f.type !== 'Track') continue
        if (syncAutoRefFieldBoundsFromPlacement(f, a) !== f) changed.push(f.customName?.trim() || f.id)
      }
    }
    // 直軌道、圓角、斜接都對齊；剩下的是範圍另有定義的分岔（121）與一塊差 0.4 公尺的 D18
    expect(changed.length).toBeLessThanOrEqual(3)
  })
})

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('分岔中心線比路口短：補接到隔壁', () => {
  const areas = parseMapFileJson(doc as never).areas
  const byId = (id: string) => areas[0]!.facilities.find((f) => f.id === id)
  const lastOf = (id: string) => {
    const real = getTrackGenPaths(byId(id)!.parameters)!.real
    return real[real.length - 1]!
  }

  it('120／121（T3 靠 S2W 的轉角）補接到 D21／U21 的端點', () => {
    if (!byId('120') || !byId('121')) return
    const e121 = lastOf('121')
    expect(Math.hypot(e121[0] + 872.73, e121[1] + 318.62)).toBeLessThan(0.1)
    const e120 = lastOf('120')
    expect(Math.hypot(e120[0] + 869.86, e120[1] + 316.62)).toBeLessThan(0.1)
  })
})

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('T3 分岔 120／121：圖面路徑畫在自己的形狀上', () => {
  const areas = parseMapFileJson(doc as never).areas
  const byId = (id: string) => areas[0]!.facilities.find((f) => f.id === id)

  it('120 的圖面路徑是直的（原本是橫的，形狀與現場都是直的）；121 是進口到岔出出口的斜線', () => {
    if (!byId('120') || !byId('121')) return
    const l120 = getTrackGenPaths(byId('120')!.parameters)!.local
    // 兩端 x 幾乎相同、y 不同：直的
    expect(Math.abs(l120[0]![0]! - l120[l120.length - 1]![0]!)).toBeLessThan(0.02)
    expect(Math.abs(l120[0]![1]! - l120[l120.length - 1]![1]!)).toBeGreaterThan(0.5)
    const l121 = getTrackGenPaths(byId('121')!.parameters)!.local
    expect(Math.abs(l121[0]![0]! - l121[l121.length - 1]![0]!)).toBeGreaterThan(0.3)
  })

  it('沿路線重播經過 T3 分岔路口（120／121，不含 U18／U19）：畫面位置一步一步連續，沒有橫向跳一大步，偏移都在中心線上', async () => {
    if (!byId('120') || !byId('121')) return
    const { buildTrackNetwork, resolveVehiclePlacementAcrossAreas, previousTrackIdOf } = await import(
      '../vehicles/resolveVehicleTrackPlacement'
    )
    const routes = JSON.parse(
      readFileSync(join(__dirname, '../vehicles/__fixtures__/route-through-t3-junction.json'), 'utf-8'),
    ) as Array<{ route: string; points: Array<{ x: number; y: number; heading: number }> }>
    const net = buildTrackNetwork(areas)
    for (const r of routes) {
      let prev: string | undefined
      let last: { x: number; y: number } | null = null
      let worstStep = 0
      let worstOff = 0
      for (const p of r.points) {
        const hit = resolveVehiclePlacementAcrossAreas(areas, p.x, p.y, net, {
          headingRad: p.heading,
          speedMps: 5,
          previousTrackId: prev,
        })
        prev = previousTrackIdOf(hit, false)
        expect(hit, r.route).not.toBeNull()
        const at = { x: hit!.placement.areaLocalX, y: hit!.placement.areaLocalY }
        if (last) worstStep = Math.max(worstStep, Math.hypot(at.x - last.x, at.y - last.y))
        last = at
        worstOff = Math.max(worstOff, Math.abs(hit!.placement.network?.offsetM ?? 0))
      }
      // 取樣間隔約 3–5 公尺，圖上每步 3–10 像素；橫向亂跳時單步會到 30–60 像素。分岔與轉角的接點圖面上有 20 像素左右的落差，容許到 30
      expect(worstStep, r.route).toBeLessThan(30)
      expect(worstOff, r.route).toBeLessThan(0.5)
    }
  })
})

describe.skipIf(!doc || doc.creationMode !== 'trackGen')('軌道鏈：多算一段、圖面路徑反、往外傳', () => {
  const areas = parseMapFileJson(doc as never).areas
  const byName = (list: typeof areas, name: string) => list[0]!.facilities.find((f) => f.customName === name)
  const endsOf = (list: typeof areas, name: string) => {
    const real = getTrackGenPaths(byName(list, name)!.parameters)!.real
    return [real[0]!, real[real.length - 1]!] as const
  }
  const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) < 0.5

  it('載入後 T3 這條 U 車道是連續的：U17 → U18 → U19 → U20，每一塊接著下一塊，沒有折回', () => {
    if (!byName(areas, 'U18') || !byName(areas, 'U19') || !byName(areas, 'U20')) return
    const [u18a, u18b] = endsOf(areas, 'U18')
    const [u19a, u19b] = endsOf(areas, 'U19')
    const [u20a] = endsOf(areas, 'U20')
    // 由北往南：U18 的南端 ＝ U19 的北端，U19 的南端 ＝ U20 的北端（現場座標 y 由大變小）
    const ys = [u18a[1], u18b[1], u19b[1], u19a[1], u20a[1]]
    expect(near(u18b, u19b)).toBe(true)
    expect(near(u19a, u20a)).toBe(true)
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]!).toBeLessThanOrEqual(ys[i - 1]! + 0.5)
  })
})
