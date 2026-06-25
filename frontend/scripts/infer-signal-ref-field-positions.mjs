/**
 * 依同 Area 內最近軌道（areaPosition + 安裝方向）推算 Signal 的 refFieldXM / refFieldYM。
 *
 * 用法：node scripts/infer-signal-ref-field-positions.mjs [map.json ...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** T3 站台區：設計上 S05/S06 分別對應 D18 / D19 */
const T3_AREA_D_SIGNAL_TRACK = {
  S05: 'D18',
  S06: 'D19',
}

/** S2W 站台區：S01/S02 分別鄰近 U05、D30 */
const S2W_SIGNAL_TRACK = {
  S01: 'U05',
  S02: 'D30',
}

const SIGNAL_TRACK_OVERRIDES = {
  ...T3_AREA_D_SIGNAL_TRACK,
  ...S2W_SIGNAL_TRACK,
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function areaPos(f) {
  return f.areaPosition ?? { x: 0, y: 0 }
}

function trackBounds(track) {
  const p = track.parameters ?? {}
  const x0 = p.refFieldXMinM
  const x1 = p.refFieldXMaxM
  const y0 = p.refFieldYMinM
  const y1 = p.refFieldYMaxM
  if (![x0, x1, y0, y1].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return null
  }
  const w = x1 - x0
  const h = y1 - y0
  if (!(w > 0) || !(h > 0)) return null
  return {
    x0,
    x1,
    y0,
    y1,
    w,
    h,
    horizontal: w >= h,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
  }
}

function mountPrefersHorizontal(mount) {
  return mount === 'left' || mount === 'right'
}

function pickTrack(area, signal) {
  const tracks = (area.facilities ?? []).filter((f) => f.type === 'Track')
  const named = SIGNAL_TRACK_OVERRIDES[signal.customName]
  if (named) {
    const hit = tracks.find((t) => t.customName === named)
    if (hit && trackBounds(hit)) return hit
  }

  const mount = signal.parameters?.mountDirection ?? 'down'
  const wantHorizontal = mountPrefersHorizontal(mount)
  const sa = areaPos(signal)

  let best = null
  let bestScore = Infinity

  for (const track of tracks) {
    const ti = trackBounds(track)
    if (!ti) continue
    const orientOk = wantHorizontal ? ti.horizontal : !ti.horizontal
    const ta = areaPos(track)
    const areaDist = Math.hypot(sa.x - ta.x, sa.y - ta.y)
    const score = areaDist + (orientOk ? 0 : 8000)
    if (score < bestScore) {
      bestScore = score
      best = track
    }
  }

  return best
}

function inferRef(signal, track) {
  const ti = trackBounds(track)
  if (!ti) return null
  const mount = signal.parameters?.mountDirection ?? 'down'
  const { x, y } = signal.positionMeters

  if (ti.horizontal) {
    let refX = Math.max(ti.x0, Math.min(ti.x1, x))
    if (mount === 'left') refX = ti.x0
    else if (mount === 'right') refX = ti.x1
    return { refFieldXM: round3(refX), refFieldYM: round3(ti.cy) }
  }

  let refY = Math.max(ti.y0, Math.min(ti.y1, y))
  if (mount === 'down') refY = ti.y0
  else if (mount === 'up') refY = ti.y1
  return { refFieldXM: round3(ti.cx), refFieldYM: round3(refY) }
}

function processMap(mapPath) {
  const abs = path.isAbsolute(mapPath) ? mapPath : path.join(__dirname, '..', mapPath)
  const map = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const updates = []

  for (const area of map.areas ?? []) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'Signal') continue
      const track = pickTrack(area, facility)
      if (!track) {
        updates.push({ signal: facility.customName, error: 'no track' })
        continue
      }
      const ref = inferRef(facility, track)
      if (!ref) {
        updates.push({ signal: facility.customName, error: 'no ref' })
        continue
      }
      facility.parameters = {
        ...(facility.parameters ?? {}),
        ...ref,
      }
      updates.push({
        signal: facility.customName,
        track: track.customName,
        ...ref,
      })
    }
  }

  bumpMapUpdatedAt(map)
  fs.writeFileSync(abs, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  return { mapPath: abs, updates }
}

function bumpMapUpdatedAt(map) {
  map.updatedAt = new Date().toISOString()
}

const targets =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ['public/maps/t3-main-version.json', 'public/maps-seed/完成版本.json']

for (const target of targets) {
  const result = processMap(target)
  console.log(`\n${result.mapPath}`)
  for (const row of result.updates) {
    if (row.error) console.log(`  ${row.signal}: ${row.error}`)
    else console.log(`  ${row.signal} → ${row.track}: (${row.refFieldXM}, ${row.refFieldYM})`)
  }
}
