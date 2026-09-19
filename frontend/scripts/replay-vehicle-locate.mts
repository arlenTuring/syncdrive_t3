/**
 * 車輛定位離線重播。
 *
 * 用法：
 *   npx tsx scripts/replay-vehicle-locate.mts --telemetry tele.jsonl [--map path/to/map.json] [--csv out.csv]
 *
 * <h3>為什麼要有這支</h3>
 * 圖台上一台車「偏移 −150%」，光看畫面分不出是三種原因的哪一種：
 * 輸入座標本來就不在路上、挑錯了軌道、或是動畫補間穿過彎道。三種要看的東西不一樣，
 * 而畫面上只剩最後的結果。
 *
 * 把車端真的送出來的遙測錄下來（`mosquitto_sub -t 'v1/vtms/+/telemetry/update'`），
 * 逐筆餵給<strong>同一支定位函式</strong>，每一筆都印出：判給哪一塊、離中心線多遠、
 * 有多少把握。改前改後拿同一批資料各跑一次，差異就是這次修改的實際效果。
 *
 * 輸入資料本身的可信度也會一起報：相鄰兩筆的位移跟車速對不對得上——對不上就是車端
 * 的問題，不是圖台的。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parseMapFileJson } from '../src/features/map-editor/utils/mapFileJson'
import { backfillTrackGenSpansInAreas } from '../src/features/map-editor/utils/trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from '../src/features/map-editor/utils/trackRefFieldBoundsRepair'
import {
  buildTrackNetwork,
  isYardVehiclePayload,
  previousTrackIdOf,
  resolveVehiclePlacementAcrossAreas,
} from '../src/features/map-editor/vehicles/resolveVehicleTrackPlacement'
import {
  collectYardSlotFieldBoxes,
  findYardSlotAtFieldMeters,
} from '../src/features/map-editor/utils/yardFacilitySlots'
import { readVehicleHeadingRad } from '../src/features/map-editor/vehicles/readVehicleHeading'
import { TRACK_HALF_WIDTH_M } from '../src/features/map-editor/vehicles/quantisedTrackCell'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const mapsDir = resolve(import.meta.dirname, '../../backend/data/published-maps')
function defaultMapPath(): string {
  const active = JSON.parse(readFileSync(join(mapsDir, 'active-map.json'), 'utf-8')) as {
    activeMapId: string
  }
  const file = join(mapsDir, `${active.activeMapId}.json`)
  if (existsSync(file)) return file
  const any = readdirSync(mapsDir).find((f) => f.endsWith('.json') && !f.includes('meta') && f !== 'active-map.json')
  if (!any) throw new Error('找不到圖資')
  return join(mapsDir, any)
}

const mapPath = arg('map') ?? defaultMapPath()
const telemetryPath = arg('telemetry')
if (!telemetryPath) {
  console.error('需要 --telemetry <jsonl>')
  process.exit(2)
}

const rawMap = JSON.parse(readFileSync(mapPath, 'utf-8')) as { mapDocument?: unknown }
const inner = (rawMap.mapDocument ?? rawMap) as Record<string, unknown>
const loaded = parseMapFileJson(inner).areas
const areas = repairTrackRefFieldBoundsInAreas(backfillTrackGenSpansInAreas(loaded).areas).areas
const network = buildTrackNetwork(areas)
const yardBoxes = collectYardSlotFieldBoxes(areas)

const codeOf = new Map<string, string>()
for (const area of areas) {
  for (const f of area.facilities ?? []) {
    codeOf.set(f.id, (f.customName || f.name || f.id).toString())
  }
}

type Sample = {
  code: string
  ts: number
  x: number
  y: number
  headingRad: number | null
  speedMps: number
  payload: Record<string, unknown>
}

const samples: Sample[] = []
for (const line of readFileSync(telemetryPath, 'utf-8').split('\n')) {
  const t = line.trim()
  if (!t.startsWith('{')) continue
  try {
    const p = JSON.parse(t) as Record<string, any>
    const pos = p.local_pose?.position
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue
    samples.push({
      code: String(p.vehicle_code),
      ts: Number(p.timestamp),
      x: pos.x,
      y: pos.y,
      headingRad: readVehicleHeadingRad(p),
      // 車端介接說明書：velocity = m/s
      speedMps: Number(p.kinematics?.velocity) || 0,
      payload: p,
    })
  } catch {
    /* 略過壞行 */
  }
}
samples.sort((a, b) => a.ts - b.ts)

type Row = {
  code: string
  i: number
  ts: number
  x: number
  y: number
  track: string
  trackId: string
  offsetM: number
  ratio: number
  along: number
  confidence: number | null
  uncertain: boolean
  yard: boolean
  stepM: number
  impliedMps: number
}

const rows: Row[] = []
const lastOf = new Map<string, { s: Sample; trackId: string | null; yard: boolean; placement: ReturnType<typeof resolveVehiclePlacementAcrossAreas> }>()
const perVehicle = new Map<string, Row[]>()

for (const s of samples) {
  const last = lastOf.get(s.code)
  // 圖台的 isYardVehicle：payload 說是場區車，或座標落在任一停車格的範圍裡
  const yard =
    isYardVehiclePayload(s.payload) || findYardSlotAtFieldMeters(yardBoxes, s.x, s.y) !== null
  const placement = resolveVehiclePlacementAcrossAreas(areas, s.x, s.y, network, {
    preferYardPlacement: yard,
    payload: s.payload,
    headingRad: s.headingRad ?? undefined,
    // 新版會用；舊版直接忽略這兩個欄位
    speedMps: s.speedMps,
    previousTrackId: previousTrackIdOf(last?.placement, last?.yard ?? false),
  } as never)
  const fix = placement?.placement.network
  const trackId = placement?.placement.trackId ?? null
  const stepM = last ? Math.hypot(s.x - last.s.x, s.y - last.s.y) : 0
  const dt = last ? (s.ts - last.s.ts) / 1000 : 0
  const row: Row = {
    code: s.code,
    i: (perVehicle.get(s.code)?.length ?? 0),
    ts: s.ts,
    x: s.x,
    y: s.y,
    track: trackId ? (codeOf.get(trackId) ?? trackId) : '(none)',
    trackId: trackId ?? '',
    offsetM: fix?.offsetM ?? NaN,
    ratio: fix ? fix.offsetM / TRACK_HALF_WIDTH_M : NaN,
    along: fix?.alongFrac ?? NaN,
    confidence: (fix as { confidence?: number } | undefined)?.confidence ?? null,
    // 圖台徽章的「≈」：第二名只差不到 1 公尺，或車頭與所選軌道方向矛盾
    uncertain:
      !!fix &&
      (((fix as { margin?: number }).margin ?? Infinity) < 1 ||
        (fix as { headingConflict?: boolean }).headingConflict === true),
    yard,
    stepM,
    impliedMps: dt > 0 ? stepM / dt : 0,
  }
  rows.push(row)
  const list = perVehicle.get(s.code) ?? []
  list.push(row)
  perVehicle.set(s.code, list)
  lastOf.set(s.code, { s, trackId, yard, placement })
}

// ── 摘要 ─────────────────────────────────────────────────────
const pad = (v: string | number, n: number) => String(v).padEnd(n)
console.log(`圖資 ${mapPath.split('/').pop()}，遙測 ${samples.length} 筆，${perVehicle.size} 台車`)
console.log(
  pad('車', 7) + pad('筆數', 6) + pad('場區', 6) + pad('換塊', 6) + pad('來回跳', 8) + pad('離軌', 8) + pad('猜的', 8)
  + pad('最大偏移%', 10) + pad('速度對不上', 10),
)

let totalSwitch = 0
let totalFlip = 0
let totalOff = 0
let totalGuess = 0
let totalSpeedMismatch = 0
for (const [code, list] of [...perVehicle.entries()].sort()) {
  let switches = 0
  let flips = 0
  let off = 0
  let guess = 0
  let maxRatio = 0
  let mismatch = 0
  for (let k = 0; k < list.length; k += 1) {
    const r = list[k]!
    if (r.yard) continue
    if (k > 0 && !list[k - 1]!.yard && list[k - 1]!.trackId !== r.trackId) {
      switches += 1
      // A → B → A：兩筆之內又跳回去，是定位在兩條軌道之間抖，不是真的換路
      if (k > 1 && !list[k - 2]!.yard && list[k - 2]!.trackId === r.trackId) flips += 1
    }
    if (Number.isFinite(r.ratio)) {
      // 離軌：偏移超過半寬、而且不是「猜的」（沒有對手，座標本身就不在這條軌道上）
      // 猜的：偏移超過半寬、但旁邊有差不多近的別條或方向矛盾——先當定位存疑，不算離軌
      if (Math.abs(r.ratio) > 1) {
        if (r.uncertain) guess += 1
        else off += 1
      }
      if (Math.abs(r.ratio) > Math.abs(maxRatio)) maxRatio = r.ratio
    }
  }
  // 速度對不對得上（需要原始速度；用 impliedMps 對 payload 速度）
  const own = samples.filter((s) => s.code === code)
  for (let k = 1; k < own.length; k += 1) {
    const dt = (own[k]!.ts - own[k - 1]!.ts) / 1000
    if (dt <= 0 || dt > 5) continue
    const implied = Math.hypot(own[k]!.x - own[k - 1]!.x, own[k]!.y - own[k - 1]!.y) / dt
    const reported = own[k]!.speedMps
    if (Math.abs(implied - reported) > Math.max(3, reported * 0.5)) mismatch += 1
  }
  totalSwitch += switches
  totalFlip += flips
  totalOff += off
  totalGuess += guess
  totalSpeedMismatch += mismatch
  console.log(
    pad(code, 7) + pad(list.length, 6) + pad(list.filter((r) => r.yard).length, 6) + pad(switches, 6)
    + pad(flips, 8) + pad(off, 8) + pad(guess, 8) + pad(`${(maxRatio * 100).toFixed(0)}%`, 10) + pad(mismatch, 10),
  )
}
console.log(
  pad('合計', 7) + pad(rows.length, 6) + pad(rows.filter((r) => r.yard).length, 6) + pad(totalSwitch, 6)
  + pad(totalFlip, 8) + pad(totalOff, 8) + pad(totalGuess, 8)
  + pad('', 10) + pad(totalSpeedMismatch, 10),
)

// ── 逐筆 ─────────────────────────────────────────────────────
const only = arg('vehicle')
if (only) {
  console.log(`\n${only} 逐筆：`)
  console.log(pad('#', 5) + pad('軌道', 12) + pad('偏移m', 9) + pad('偏移%', 9) + pad('along', 8) + pad('把握', 7) + pad('位移m', 8))
  for (const r of perVehicle.get(only) ?? []) {
    console.log(
      pad(r.i, 5) + pad(r.track, 12) + pad(Number.isFinite(r.offsetM) ? r.offsetM.toFixed(2) : '-', 9)
      + pad(Number.isFinite(r.ratio) ? `${(r.ratio * 100).toFixed(0)}%` : '-', 9)
      + pad(Number.isFinite(r.along) ? r.along.toFixed(3) : '-', 8)
      + pad(r.confidence == null ? '-' : r.confidence.toFixed(2), 7)
      + pad(r.stepM.toFixed(1), 8),
    )
  }
}

const csv = arg('csv')
if (csv) {
  writeFileSync(
    csv,
    ['code,i,ts,x,y,track,offsetM,ratio,along,confidence,stepM']
      .concat(
        rows.map((r) =>
          [r.code, r.i, r.ts, r.x.toFixed(2), r.y.toFixed(2), r.track, r.offsetM.toFixed(3), r.ratio.toFixed(3), r.along.toFixed(4), r.confidence ?? '', r.stepM.toFixed(2)].join(','),
        ),
      )
      .join('\n'),
  )
  console.log(`\n已寫出 ${csv}`)
}
