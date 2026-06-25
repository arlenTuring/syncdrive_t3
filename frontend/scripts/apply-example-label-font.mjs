/**
 * 內建範例地圖：軌道 30px，其餘設施 16px
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mapsDir = path.join(__dirname, '../public/maps')

const MAP_FILES = [
  'example-parking-row.json',
  'example-intersection.json',
  'example-depot.json',
  'vtms-main-loop.json',
]

const TRACK_PX = 30
const OTHER_PX = 16

for (const file of MAP_FILES) {
  const fp = path.join(mapsDir, file)
  const doc = JSON.parse(fs.readFileSync(fp, 'utf8'))
  let tracks = 0
  let other = 0
  for (const f of doc.facilities ?? []) {
    const px = f.type === 'Track' ? TRACK_PX : OTHER_PX
    f.parameters = f.parameters ?? {}
    f.parameters.labelStyle = {
      ...(f.parameters.labelStyle ?? {}),
      fontSizePx: px,
    }
    delete f.parameters.labelStyle.fontSizeScale
    if (f.type === 'Track') tracks++
    else other++
  }
  fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`${file}: Track ${tracks} @ ${TRACK_PX}px, other ${other} @ ${OTHER_PX}px`)
}
