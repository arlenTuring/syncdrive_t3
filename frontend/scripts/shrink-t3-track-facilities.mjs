/**
 * 對指定地圖 JSON：縮小 Track（或 Facility）的 areaSizePx，
 * 並依列（y）、欄（x）累進平移，維持元件間邊距不變。
 *
 * 用法：
 *   node scripts/shrink-t3-track-facilities.mjs [選項] [地圖.json ...]
 *
 * 選項：
 *   --dw <px>     寬度減量（預設 30）
 *   --dh <px>     高度減量（預設 8）
 *   --types a,b   目標類型（預設 Track；可 Track,Facility）
 *
 * 未指定路徑時預設：public/maps/t3-main-version.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MAP = path.join(__dirname, '../public/maps/t3-main-version.json')

function parseArgs(argv) {
  const types = []
  const paths = []
  let dw = 30
  let dh = 8
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dw' && argv[i + 1]) {
      dw = Number(argv[++i])
    } else if (a === '--dh' && argv[i + 1]) {
      dh = Number(argv[++i])
    } else if (a === '--types' && argv[i + 1]) {
      types.push(...argv[++i].split(',').map((t) => t.trim()))
    } else if (!a.startsWith('--')) {
      paths.push(a)
    }
  }
  return {
    dw,
    dh,
    types: new Set(types.length ? types : ['Track']),
    paths: paths.length ? paths.map((p) => path.resolve(p)) : [DEFAULT_MAP],
  }
}

const { dw: DW, dh: DH, types: TARGET_TYPES, paths: mapPaths } = parseArgs(
  process.argv,
)
const MIN_W = 1
const MIN_H = 1
const ROW_TOL = 4
const COL_TOL = 4
const r2 = (n) => Math.round(n * 100) / 100

function clusterBy(items, getVal, tol) {
  const sorted = [...items].sort((a, b) => getVal(a) - getVal(b))
  const groups = []
  let cur = []
  let ref = null
  for (const item of sorted) {
    const v = getVal(item)
    if (cur.length === 0 || Math.abs(v - ref) <= tol) {
      cur.push(item)
      if (cur.length === 1) ref = v
    } else {
      groups.push(cur)
      cur = [item]
      ref = v
    }
  }
  if (cur.length) groups.push(cur)
  return groups
}

function syncMeters(f, domain, layout) {
  const spanW = domain.xMaxM - domain.xMinM
  const spanH = domain.yMaxM - domain.yMinM
  const ap = f.areaPosition
  const asp = f.areaSizePx
  if (!ap || !asp) return
  f.positionMeters = {
    x: r2(domain.xMinM + (ap.x / layout.wPx) * spanW),
    y: r2(domain.yMinM + (ap.y / layout.hPx) * spanH),
  }
  f.sizeMeters = {
    w: r2((asp.w / layout.wPx) * spanW),
    h: r2((asp.h / layout.hPx) * spanH),
  }
}

function processArea(area) {
  const targets = area.facilities.filter(
    (f) =>
      TARGET_TYPES.has(f.type) &&
      f.areaPosition &&
      f.areaSizePx &&
      typeof f.areaPosition.x === 'number' &&
      typeof f.areaPosition.y === 'number',
  )
  if (targets.length === 0) return 0

  for (const f of targets) {
    const oldW = f.areaSizePx.w
    const oldH = f.areaSizePx.h
    f.areaSizePx.w = r2(Math.max(MIN_W, oldW - DW))
    f.areaSizePx.h = r2(Math.max(MIN_H, oldH - DH))
  }

  const rows = clusterBy(targets, (f) => f.areaPosition.y, ROW_TOL)
  for (const row of rows) {
    row.sort((a, b) => a.areaPosition.x - b.areaPosition.x)
    row.forEach((f, i) => {
      f.areaPosition.x = r2(f.areaPosition.x - i * DW)
    })
  }

  const cols = clusterBy(targets, (f) => f.areaPosition.x, COL_TOL)
  for (const col of cols) {
    col.sort((a, b) => a.areaPosition.y - b.areaPosition.y)
    col.forEach((f, j) => {
      f.areaPosition.y = r2(f.areaPosition.y - j * DH)
    })
  }

  for (const f of targets) {
    syncMeters(f, area.domain, area.layout)
  }
  return targets.length
}

function processMap(map) {
  let n = 0
  for (const area of map.areas) {
    n += processArea(area)
  }
  return n
}

let any = false
for (const mapPath of mapPaths) {
  if (!fs.existsSync(mapPath)) {
    console.error(`找不到檔案：${mapPath}`)
    process.exitCode = 1
    continue
  }
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  const count = processMap(map)
  fs.writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`)
  console.log(
    `已更新 ${count} 個 ${[...TARGET_TYPES].join('/')}（寬-${DW} 高-${DH}）：${mapPath}`,
  )
  any = true
}

if (!any) process.exit(1)
