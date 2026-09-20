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
  healStaleTrackPathsInAreas,
  listStaleTrackPaths,
  rederiveIfStale,
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

  it('載入時自動修好複製來的 U04；只有一端對不上的 U18／U19 不動；其餘不誤報', () => {
    const labels = listStaleTrackPaths(areas).map((s) => s.label).sort()
    // U04 兩端都對不上：載入就已依鄰居重建，不會再被列為過期；U05 也跟著接上了
    expect(labels).not.toContain('U04')
    expect(labels).not.toContain('U05')
    expect(labels.filter((l) => !['U18', 'U19'].includes(l))).toEqual([])
    const real = getTrackGenPaths(byName('U04').parameters)!.real
    expect(Math.hypot(real[0]![0] + 138.4, real[0]![1] + 19.86)).toBeLessThan(0.05)
    expect(real[real.length - 1]![1]).toBeGreaterThan(-14)
  })

  it('healStaleTrackPathsInAreas：兩端都錯才改，一端錯的（互相對不上）只回報', () => {
    // 用還沒修的原始資料：把 U04 換回複製來的樣子
    const u06 = byName('U06')
    const stale = {
      ...byName('U04'),
      parameters: { ...byName('U04').parameters, trackGenRealPath: u06.parameters!.trackGenRealPath },
    }
    const broken = { ...area, facilities: area.facilities.map((f) => (f.id === stale.id ? stale : f)) }
    const out = healStaleTrackPathsInAreas([broken])
    expect(out.healed).toEqual(['U04'])
    expect(out.ambiguous.sort()).toEqual(['U18', 'U19'])
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

  it('沒過期的軌道 rederiveIfStale 回 null，不去動它', () => {
    expect(rederiveIfStale(byName('U06'), area)).toBeNull()
  })

  it('剛動過的軌道才檢查：移動 U04 才重建，沒動就不動（即使它過期）', () => {
    const before = snapshotGeometry(areas)
    // 沒有任何變動：不檢查
    expect(movedFacilityKeys(before, snapshotGeometry(areas))).toEqual([])
    const u04 = byName('U04')
    const moved = areas.map((a) => ({
      ...a,
      facilities: a.facilities.map((f) =>
        f.id === u04.id ? { ...f, areaPosition: { ...f.areaPosition, x: f.areaPosition.x + 5 } } : f,
      ),
    }))
    const keys = movedFacilityKeys(before, snapshotGeometry(moved))!
    expect(keys).toEqual([`${area.id}|${u04.id}`])
    const out = rebuildStaleAmong(moved, keys)
    if (findStaleTrackPathEnds(u04, area).length > 0) expect(out.rebuilt.map((r) => r.label)).toEqual(['U04'])
    // 沒有被列入的軌道（U05 也是「過期」的一方）不會被連帶重建
    const none = rebuildStaleAmong(moved, [`${area.id}|${byName('U06').id}`])
    expect(none.rebuilt).toEqual([])
    expect(none.areas).toBe(moved)
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
