/**
 * 將 maps-seed 或地圖庫匯出檔寫入 public/maps 內建範例。
 * 執行：node scripts/sync-builtin-example-maps.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAPS_DIR = join(__dirname, '../public/maps')
const SEED_DIR = join(__dirname, '../public/maps-seed')

const TARGETS = [
  {
    seedNames: [
      '完成版本.json',
      '軌道合併加道路線.json',
      '主要版本.json',
      't3-main-version.json',
    ],
    out: 't3-main-version.json',
    mapId: 't3-main-version',
    displayName: '軌道合併加道路線',
  },
]

function readSeed(names) {
  for (const name of names) {
    const p = join(SEED_DIR, name)
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8'))
    }
  }
  return null
}

let wrote = 0
for (const t of TARGETS) {
  const doc = readSeed(t.seedNames)
  if (!doc) {
    console.warn(`略過 ${t.out}：未找到 maps-seed/${t.seedNames[0]}`)
    continue
  }
  const next = {
    ...doc,
    mapId: t.mapId,
    displayName: t.displayName,
  }
  writeFileSync(join(MAPS_DIR, t.out), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${t.out}`)
  wrote++
}

if (wrote === 0) {
  console.log(
    '提示：請將「軌道合併加道路線」匯出 JSON 放到 public/maps-seed/ 後再執行。',
  )
  process.exit(0)
}
