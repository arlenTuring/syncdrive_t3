import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseMapFileJson } from '../utils/mapFileJson'
import { backfillTrackGenSpansInAreas } from '../utils/trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from '../utils/trackRefFieldBoundsRepair'
import { collectYardSlotFieldBoxes, findYardSlotAtFieldMeters } from '../utils/yardFacilitySlots'
import { readVehicleHeadingRad, readVehicleSpeedMps } from './readVehicleHeading'
import {
  buildTrackNetwork,
  isYardVehiclePayload,
  resolveVehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement'
import { TRACK_HALF_WIDTH_M } from './quantisedTrackCell'

/**
 * 真實遙測重播：車端真的送出來的座標，逐筆餵給定位。
 *
 * fixture 是從模擬器錄下來的四個時段，每一段都是<strong>舊規則判給錯誤軌道</strong>的
 * 地方：
 * <ul>
 *   <li>PMS02 走 D37，舊規則判給對向的 U37，偏 4.66 倍半寬（約 7.8 公尺）。</li>
 *   <li>PMS01 走 D02，舊規則判給 U02，偏 4.68 倍半寬。</li>
 *   <li>PMS05 走 D35/U35 交叉軌道，舊規則判給 D34，偏 2.1 倍半寬。</li>
 *   <li>PMS02 走 T3 支線的轉轍器一帶。</li>
 * </ul>
 * 圖資在 .gitignore 裡，CI 上沒有就跳過——用途是「改完定位或改完圖之後自己先跑一次」。
 */

const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')

function loadActiveMap(): unknown | null {
  try {
    const active = JSON.parse(readFileSync(join(MAPS_DIR, 'active-map.json'), 'utf-8')) as {
      activeMapId: string
    }
    const file = join(MAPS_DIR, `${active.activeMapId}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null
  } catch {
    return null
  }
}

const raw = loadActiveMap() as { mapDocument?: unknown } | null
const inner = raw ? ((raw.mapDocument ?? raw) as { creationMode?: string }) : null

describe.skipIf(!inner || inner.creationMode !== 'trackGen')('真實遙測重播：定位挑對軌道', () => {
  const areas = repairTrackRefFieldBoundsInAreas(
    backfillTrackGenSpansInAreas(parseMapFileJson(inner as never).areas).areas,
  ).areas
  const network = buildTrackNetwork(areas)
  const yardBoxes = collectYardSlotFieldBoxes(areas)
  const codeOf = new Map<string, string>()
  for (const area of areas) {
    for (const f of area.facilities ?? []) codeOf.set(f.id, String(f.customName || f.name || f.id))
  }

  type Row = { code: string; track: string; ratio: number; confidence: number; yard: boolean }
  const rows: Row[] = []
  const samples = readFileSync(
    join(__dirname, '__fixtures__/telemetry-lane-choice.jsonl'),
    'utf-8',
  )
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, any>)

  const previous = new Map<string, string | undefined>()
  for (const p of samples) {
    const x = p.local_pose.position.x as number
    const y = p.local_pose.position.y as number
    const yard = isYardVehiclePayload(p) || findYardSlotAtFieldMeters(yardBoxes, x, y) !== null
    const placement = resolveVehiclePlacementAcrossAreas(areas, x, y, network, {
      preferYardPlacement: yard,
      payload: p,
      headingRad: readVehicleHeadingRad(p) ?? undefined,
      speedMps: readVehicleSpeedMps(p) ?? undefined,
      previousTrackId: previous.get(p.vehicle_code),
    })
    const fix = placement?.placement.network
    previous.set(p.vehicle_code, fix ? placement!.placement.trackId : undefined)
    rows.push({
      code: p.vehicle_code,
      track: placement ? (codeOf.get(placement.placement.trackId) ?? '?') : '(none)',
      ratio: fix ? fix.offsetM / TRACK_HALF_WIDTH_M : NaN,
      confidence: fix?.confidence ?? NaN,
      yard,
    })
  }

  const of = (code: string) => rows.filter((r) => r.code === code && !r.yard && Number.isFinite(r.ratio))

  it('PMS02 走 D37：不再判給對向的 U37', () => {
    expect(of('PMS02').filter((r) => r.track === 'U37')).toEqual([])
    // 走在 D37 上的那幾筆壓在中心線
    const d37 = of('PMS02').filter((r) => r.track === 'D37')
    expect(d37.length).toBeGreaterThan(10)
    for (const r of d37) expect(Math.abs(r.ratio)).toBeLessThan(0.1)
  })

  it('PMS01 走 D02：不再判給 U02', () => {
    expect(of('PMS01').filter((r) => r.track === 'U02')).toEqual([])
    for (const r of of('PMS01')) expect(Math.abs(r.ratio)).toBeLessThan(0.3)
  })

  it('PMS05 走交叉軌道：交叉那一塊判給交叉軌道，不是隔壁的 D34', () => {
    const cross = of('PMS05').filter((r) => r.track === 'D35/U35')
    expect(cross.length).toBeGreaterThan(10)
    for (const r of cross) expect(Math.abs(r.ratio)).toBeLessThan(0.1)
  })

  it('偏離中心線超過兩倍半寬的筆數，比舊規則少很多', () => {
    // 舊規則在這批資料上有 80 筆偏移 >100%；現在剩 22 筆，都是輸入本身就不在軌道上的。
    // 上限抓輸入本身離軌的那些，不要求為零——那是車端的座標，不是定位的錯。
    const off = rows.filter((r) => !r.yard && Number.isFinite(r.ratio) && Math.abs(r.ratio) > 1)
    expect(off.length).toBeLessThanOrEqual(24)
  })

  it('離軌的那些，把握度要低（畫面上才標得出「≈」）', () => {
    const far = rows.filter((r) => !r.yard && Number.isFinite(r.ratio) && Math.abs(r.ratio) > 1.5)
    expect(far.length).toBeGreaterThan(0)
    for (const r of far) expect(r.confidence).toBeLessThan(0.5)
  })
})
