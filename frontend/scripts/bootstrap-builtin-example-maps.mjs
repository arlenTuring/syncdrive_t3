/**
 * 自 maps-seed/完成版本.json 產生內建範例（無 seed 時請先放入匯出檔）。
 * 執行：node scripts/bootstrap-builtin-example-maps.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAPS = join(__dirname, '../public/maps')
const SEED = join(__dirname, '../public/maps-seed/完成版本.json')

if (!existsSync(SEED)) {
  console.error('找不到 maps-seed/完成版本.json，請先放入「軌道合併加道路線」匯出檔。')
  process.exit(1)
}

const doc = JSON.parse(readFileSync(SEED, 'utf8'))
const main = {
  ...doc,
  mapId: 't3-main-version',
  displayName: '軌道合併加道路線',
}

writeFileSync(join(MAPS, 't3-main-version.json'), `${JSON.stringify(main, null, 2)}\n`)
console.log('Bootstrapped t3-main-version.json')
