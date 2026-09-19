/**
 * 圖面中心線順序稽核。
 *
 * 用法：npx tsx scripts/audit-track-orientation.mts [--map path/to/map.json]
 *
 * 車輛在方塊裡的畫面位置＝「真實路徑走了幾成」對到「圖面路徑同樣幾成」，所以兩條路徑的
 * 順序要一致。順序反了的方塊，車被畫在鏡像位置，跟鄰居接起來的地方會整個跳一段。
 *
 * 這支用<strong>接點的畫面落差</strong>看：每一塊跟它相連的鄰居，端點在畫面上該貼在一起。把這
 * 一塊的圖面路徑倒過來之後，接點的平均落差若小很多，順序就有疑問。
 *
 * 圖台載入時已經照方塊自己的場域範圍倒正了沒有旋轉、證據充分的（見 trackGenOrientation）。
 * 這裡列的是<strong>倒正之後還剩下的疑點</strong>——通常是旋轉 90° 的方塊：接點證據說反了，
 * 但站點圖釘是照現在的對法放的，倒過來會讓車停在圖釘的另一端，要由畫圖的人決定哪邊才對。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parseMapFileJson } from '../src/features/map-editor/utils/mapFileJson'
import { backfillTrackGenSpansInAreas } from '../src/features/map-editor/utils/trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from '../src/features/map-editor/utils/trackRefFieldBoundsRepair'
import {
  buildTrackNetwork,
  trackAreaLocalAt,
} from '../src/features/map-editor/vehicles/resolveVehicleTrackPlacement'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const mapsDir = resolve(import.meta.dirname, '../../backend/data/published-maps')
function defaultMap(): string {
  const active = JSON.parse(readFileSync(join(mapsDir, 'active-map.json'), 'utf-8')) as { activeMapId: string }
  const file = join(mapsDir, `${active.activeMapId}.json`)
  if (existsSync(file)) return file
  const any = readdirSync(mapsDir).find((f) => f.endsWith('.json') && !f.includes('meta') && f !== 'active-map.json')
  if (!any) throw new Error('找不到圖資')
  return join(mapsDir, any)
}

const raw = JSON.parse(readFileSync(arg('map') ?? defaultMap(), 'utf-8')) as { mapDocument?: unknown }
const parsed = parseMapFileJson(raw.mapDocument ?? raw)
const areas = repairTrackRefFieldBoundsInAreas(backfillTrackGenSpansInAreas(parsed.areas).areas).areas
const index = buildTrackNetwork(areas).genIndex
if (!index) throw new Error('圖資沒有生成軌道')

const area = areas[0]!
const byId = new Map(area.facilities.map((f) => [f.id, f]))
const label = (id: string) => String(byId.get(id)?.customName || id)

function drawnEnd(id: string, end: 0 | 1, flip: boolean) {
  const f = byId.get(id)!
  const local = (f.parameters as { trackGenLocalPath: number[][] }).trackGenLocalPath
  const probe = { ...f, parameters: { ...f.parameters, trackGenLocalPath: flip ? [...local].reverse() : local } }
  return trackAreaLocalAt(probe as never, area, end, 0)!
}

const ids = [...new Set(index.pieces.map((p) => p.facilityId))]
const rows: Array<{ 方塊: string; 旋轉: number; 接點數: number; 現況落差px: number; 倒過來落差px: number }> = []
for (const id of ids) {
  const joins = index.joins.get(id) ?? []
  if (joins.length === 0) continue
  const gap = (flip: boolean) => {
    let total = 0
    for (const j of joins) {
      const a = drawnEnd(id, j.end, flip)
      const b = drawnEnd(j.to, j.toEnd, false)
      total += Math.hypot(a.x - b.x, a.y - b.y)
    }
    return total / joins.length
  }
  const asIs = gap(false)
  const flipped = gap(true)
  if (flipped < asIs * 0.6 && asIs > 10) {
    rows.push({
      方塊: label(id),
      旋轉: byId.get(id)?.rotation ?? 0,
      接點數: joins.length,
      現況落差px: Math.round(asIs * 10) / 10,
      倒過來落差px: Math.round(flipped * 10) / 10,
    })
  }
}
console.log(rows.length ? '倒過來會讓接點更貼的方塊（疑點）：' : '沒有疑點：所有方塊的接點在畫面上都貼得上。')
if (rows.length) console.table(rows)
