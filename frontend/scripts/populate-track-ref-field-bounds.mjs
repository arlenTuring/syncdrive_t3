/**
 * 為 t3-main-version 內所有 Track 填入／校正場域範圍（refField*M）。
 *
 * 座標系：場域公尺、原點左下、X 向右、Y 向上。
 *
 * 執行：node frontend/scripts/populate-track-ref-field-bounds.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAP_PATH = join(__dirname, '../public/maps/t3-main-version.json')
const MAP_SEED_PATH = join(__dirname, '../public/maps-seed/完成版本.json')

const LEN = 50
const W = 3.5
const MAP_VERSION = 'v0.1.0'

const round4 = (n) => Math.round(n * 10000) / 10000

/** @type {Record<string, { xMinM: number, xMaxM: number, yMinM: number, yMaxM: number }>} */
const CANONICAL = {}

function h(xMin, yMin, xMax = xMin + LEN, yMax = yMin + W) {
  return {
    xMinM: round4(xMin),
    xMaxM: round4(xMax),
    yMinM: round4(yMin),
    yMaxM: round4(yMax),
  }
}

function v(xMin, yMin, yMax, xMax = xMin + W) {
  return {
    xMinM: round4(xMin),
    xMaxM: round4(xMax),
    yMinM: round4(yMin),
    yMaxM: round4(yMax),
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// ── 1. D16–D01：x 100→900（每段 50 m），y 100–103.5 ───────────────────────
const D_UPPER_Y_MIN = 100
const D_UPPER_Y_MAX = 103.5
for (let n = 1; n <= 16; n++) {
  const xMin = 100 + (16 - n) * LEN
  CANONICAL[`D${pad2(n)}`] = h(xMin, D_UPPER_Y_MIN, xMin + LEN, D_UPPER_Y_MAX)
}

// ── 2. U16：x 103.5–150，y 103.5–107 ─────────────────────────────────────
const U_UPPER_Y_MIN = 103.5
const U_UPPER_Y_MAX = 107
CANONICAL.U16 = h(103.5, U_UPPER_Y_MIN, 150, U_UPPER_Y_MAX)

// ── 3. U15–U01：x 150→900（每段 50 m），y 103.5–107 ─────────────────────
for (let n = 1; n <= 15; n++) {
  const xMin = 150 + (15 - n) * LEN
  CANONICAL[`U${pad2(n)}`] = h(xMin, U_UPPER_Y_MIN, xMin + LEN, U_UPPER_Y_MAX)
}

// ── 4. D20–D35：x 100→900（每段 50 m），y 303.5–307 ─────────────────────
const D_LOWER_Y_MIN = 303.5
const D_LOWER_Y_MAX = 307
for (let n = 20; n <= 35; n++) {
  const xMin = 100 + (n - 20) * LEN
  CANONICAL[`D${pad2(n)}`] = h(xMin, D_LOWER_Y_MIN, xMin + LEN, D_LOWER_Y_MAX)
}

// ── 5. U20：x 103.5–150，y 300–303.5 ─────────────────────────────────────
const U_LOWER_Y_MIN = 300
const U_LOWER_Y_MAX = 303.5
CANONICAL.U20 = h(103.5, U_LOWER_Y_MIN, 150, U_LOWER_Y_MAX)

// ── 6. U21–U35：x 150→900（每段 50 m），y 300–303.5 ─────────────────────
for (let n = 21; n <= 35; n++) {
  const xMin = 150 + (n - 21) * LEN
  CANONICAL[`U${pad2(n)}`] = h(xMin, U_LOWER_Y_MIN, xMin + LEN, U_LOWER_Y_MAX)
}

// ── 7. D17–D19：x 100–103.5 ─────────────────────────────────────────────
const T3_D_X_MIN = 100
const T3_D_X_MAX = 103.5
CANONICAL.D17 = v(T3_D_X_MIN, 103.5, 150, T3_D_X_MAX)
CANONICAL.D18 = v(T3_D_X_MIN, 150, 250, T3_D_X_MAX)
CANONICAL.D19 = v(T3_D_X_MIN, 250, 303.5, T3_D_X_MAX)

// ── 8. U17–U19：x 103.5–107 ─────────────────────────────────────────────
const T3_U_X_MIN = 103.5
const T3_U_X_MAX = 107
CANONICAL.U17 = v(T3_U_X_MIN, 107, 150, T3_U_X_MAX)
CANONICAL.U18 = v(T3_U_X_MIN, 150, 250, T3_U_X_MAX)
CANONICAL.U19 = v(T3_U_X_MIN, 250, 300, T3_U_X_MAX)

// ── N2W 匯流軌 T06–T10、T03/T04、T05 ─────────────────────────────────────
const D01_X = 850
const N2W_T_Y = 399.4744
for (let n = 6; n <= 10; n++) {
  CANONICAL[`T${pad2(n)}`] = h(
    D01_X - (10 - n) * LEN,
    N2W_T_Y,
    D01_X - (10 - n) * LEN + LEN,
    N2W_T_Y + W,
  )
}
CANONICAL.T05 = v(D01_X + LEN - W, D_UPPER_Y_MIN, N2W_T_Y + W - D_UPPER_Y_MIN, D01_X + LEN)
const N2W_RX = 881.704
CANONICAL.T04 = {
  xMinM: round4(N2W_RX),
  xMaxM: round4(N2W_RX + W),
  yMinM: round4(374.0618),
  yMaxM: round4(392.0618),
}
CANONICAL.T03 = {
  xMinM: round4(N2W_RX - 1.07),
  xMaxM: round4(N2W_RX - 1.07 + W),
  yMinM: round4(361.3074),
  yMaxM: round4(379.3074),
}

// ── Area E 匯流 T11–T18 ────────────────────────────────────────────────────
const D20_X = 100
const E_T_Y = 41.7727
for (let n = 12; n <= 18; n++) {
  CANONICAL[`T${pad2(n)}`] = h(
    D20_X + (n - 12) * LEN,
    E_T_Y,
    D20_X + (n - 12) * LEN + LEN,
    E_T_Y + W,
  )
}
CANONICAL.T11 = v(1.1651, E_T_Y, D_LOWER_Y_MIN + W - E_T_Y, 1.1651 + W)

// ── S2W 斜向匯流 T01/T02 ───────────────────────────────────────────────────
const S2W_RX = 894.4075
CANONICAL.T02 = {
  xMinM: round4(S2W_RX),
  xMaxM: round4(S2W_RX + W),
  yMinM: round4(76.5359),
  yMaxM: round4(94.5359),
}
CANONICAL.T01 = {
  xMinM: round4(S2W_RX),
  xMaxM: round4(S2W_RX + W),
  yMinM: round4(57.9648),
  yMaxM: round4(75.9648),
}

CANONICAL.R06 = CANONICAL.D06

/** segmentId 與 customName 對齊（保留 R06 等歷史代碼） */
const SEGMENT_ID_OVERRIDES = {
  D06: 'R06',
}

function domainSpan(domain) {
  return {
    w: Math.max(0.001, domain.xMaxM - domain.xMinM),
    h: Math.max(0.001, domain.yMaxM - domain.yMinM),
  }
}

function inferFromFacility(f, area) {
  const pxW = f.areaSizePx?.w ?? LEN
  const pxH = f.areaSizePx?.h ?? W
  const horizontal = pxW >= pxH * 1.2
  const span = domainSpan(area.domain)
  const layout = area.layout
  const mPerPxX = span.w / Math.max(1, layout.wPx)
  const mPerPxY = span.h / Math.max(1, layout.hPx)
  const x = f.positionMeters.x
  const y = f.positionMeters.y
  if (horizontal) {
    return h(x, y, x + Math.max(LEN, pxW * mPerPxX), y + W)
  }
  return v(x, y, y + Math.max(LEN, pxH * mPerPxY))
}

function normalizeTrackName(name) {
  if (!name || typeof name !== 'string') return name
  const m = /^U0?(\d+)$/.exec(name.trim())
  if (m) return `U${pad2(Number(m[1]))}`
  const d = /^D0?(\d+)$/.exec(name.trim())
  if (d) return `D${pad2(Number(d[1]))}`
  return name.trim()
}

function resolveBounds(f, area) {
  const name = normalizeTrackName(f.customName)
  if (name && CANONICAL[name]) return CANONICAL[name]
  const seg = normalizeTrackName(f.parameters?.segmentId)
  if (seg && CANONICAL[seg]) return CANONICAL[seg]
  return inferFromFacility(f, area)
}

function boundsKey(b) {
  return `${b.xMinM},${b.xMaxM},${b.yMinM},${b.yMaxM}`
}

function applyRefFields(map) {
  const changes = []
  let updated = 0
  let fallback = 0

  for (const area of map.areas) {
    for (const f of area.facilities ?? []) {
      if (f.type !== 'Track') continue
      const name = normalizeTrackName(f.customName)
      const bounds = resolveBounds(f, area)
      const fromCanon = !!(
        CANONICAL[name] ||
        CANONICAL[normalizeTrackName(f.parameters?.segmentId)]
      )
      if (!fromCanon) fallback++

      const prev = {
        xMinM: f.parameters?.refFieldXMinM,
        xMaxM: f.parameters?.refFieldXMaxM,
        yMinM: f.parameters?.refFieldYMinM,
        yMaxM: f.parameters?.refFieldYMaxM,
        segmentId: f.parameters?.segmentId,
      }

      const nextSegmentId = SEGMENT_ID_OVERRIDES[name] ?? name
      f.parameters = {
        ...(f.parameters ?? {}),
        segmentId: nextSegmentId,
        refFieldXMinM: bounds.xMinM,
        refFieldXMaxM: bounds.xMaxM,
        refFieldYMinM: bounds.yMinM,
        refFieldYMaxM: bounds.yMaxM,
      }

      const changed =
        boundsKey(prev) !== boundsKey(bounds) || prev.segmentId !== nextSegmentId
      if (changed) {
        changes.push({
          name,
          area: area.customName,
          ref: `${boundsKey(prev)} → ${boundsKey(bounds)}`,
        })
      }
      updated++
    }
  }

  return { updated, fallback, changes }
}

function run(path) {
  const map = JSON.parse(readFileSync(path, 'utf8'))
  const { updated, fallback, changes } = applyRefFields(map)
  map.version = MAP_VERSION
  map.mapId = 't3-main-version'
  map.displayName = '軌道合併加道路線'
  map.updatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(map, null, 2) + '\n')
  console.log(`\n${path}`)
  console.log(
    `  version ${map.version} · ${updated} tracks · ${fallback} fallback · ${changes.length} changed`,
  )
  for (const c of changes) {
    console.log(`  [${c.name}] ${c.area}`)
    console.log(`    ref: ${c.ref}`)
  }
  return map
}

run(MAP_PATH)
writeFileSync(MAP_SEED_PATH, readFileSync(MAP_PATH, 'utf8'))
console.log(`\nSynced → ${MAP_SEED_PATH}`)
