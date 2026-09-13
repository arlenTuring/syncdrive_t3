/**
 * 驗證地圖 JSON 是否符合編輯器 schema v2 與 refField（場域座標／範圍）原則。
 * 用法：node scripts/validate-map-file.mjs <path-to.json>
 */
import fs from 'node:fs'
import path from 'node:path'

const VALID_TYPES = new Set([
  'Slot',
  'Facility',
  'Geofence',
  'PSD',
  'Signal',
  'Track',
  'Pole',
  'Zone',
])

const POINT_REF_TYPES = new Set(['Signal', 'Pole', 'PSD'])
const BOUNDS_REF_TYPES = new Set(['Track', 'Facility', 'Geofence'])

const POINT_KEYS = ['refFieldXM', 'refFieldYM']
const BOUNDS_KEYS = [
  'refFieldXMinM',
  'refFieldXMaxM',
  'refFieldYMinM',
  'refFieldYMaxM',
]

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNumOrNull(v) {
  return v === null || isNum(v)
}

function hasValidPointRef(p) {
  return isNum(p?.refFieldXM) && isNum(p?.refFieldYM)
}

function hasValidBoundsRef(p) {
  const keys = BOUNDS_KEYS
  if (!keys.every((k) => k in (p ?? {}))) return false
  const vals = keys.map((k) => p[k])
  if (!vals.every(isNum)) return false
  const [x0, x1, y0, y1] = vals
  return x1 > x0 && y1 > y0
}

function validate(filePath) {
  const errors = []
  const warnings = []
  const stats = {
    areas: 0,
    facilities: 0,
    byType: {},
    signalsMissingRef: [],
    pointMissingKeys: [],
    boundsMissingKeys: [],
    boundsInvalid: [],
    missingLayoutAnchor: [],
    duplicateIds: [],
  }

  let map
  try {
    map = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失敗: ${e.message}`], warnings, stats }
  }

  if (map.schemaVersion !== 2) {
    errors.push(`schemaVersion 應為 2，目前為 ${map.schemaVersion}`)
  }
  if (!map.mapId || typeof map.mapId !== 'string') {
    errors.push('缺少 mapId')
  }
  if (!map.displayName || typeof map.displayName !== 'string') {
    errors.push('缺少 displayName')
  }
  if (!map.pixelSize?.width || !map.pixelSize?.height) {
    errors.push('pixelSize 格式錯誤')
  }
  if (!Array.isArray(map.areas) || map.areas.length === 0) {
    errors.push('areas 不可為空')
  }

  const seenIds = new Map()

  for (const [ai, area] of (map.areas ?? []).entries()) {
    stats.areas++
    const ap = `Area[${ai}] ${area.id ?? '?'}`
    const layout = area.layout
    const domain = area.domain
    if (
      !layout ||
      !['xPx', 'yPx', 'wPx', 'hPx'].every((k) => isNum(layout[k]))
    ) {
      errors.push(`${ap}: layout 格式錯誤`)
    }
    if (
      !domain ||
      !['xMinM', 'xMaxM', 'yMinM', 'yMaxM'].every((k) => isNum(domain[k]))
    ) {
      errors.push(`${ap}: domain 格式錯誤`)
    } else if (domain.xMaxM <= domain.xMinM || domain.yMaxM <= domain.yMinM) {
      errors.push(`${ap}: domain 範圍無效`)
    }

    for (const [fi, f] of (area.facilities ?? []).entries()) {
      stats.facilities++
      const fp = `${ap} facility[${fi}] ${f.id ?? '?'}`
      const type = f.type
      stats.byType[type] = (stats.byType[type] ?? 0) + 1

      if (!VALID_TYPES.has(type)) {
        errors.push(`${fp}: 不支援的 type "${type}"`)
        continue
      }
      if (!f.id) errors.push(`${fp}: 缺少 id`)
      if (!f.name) errors.push(`${fp}: 缺少 name`)
      if (!f.positionMeters || !isNum(f.positionMeters.x) || !isNum(f.positionMeters.y)) {
        errors.push(`${fp}: positionMeters 格式錯誤`)
      }
      if (!f.areaPosition || !isNum(f.areaPosition.x) || !isNum(f.areaPosition.y)) {
        errors.push(`${fp}: areaPosition 格式錯誤`)
      }
      if (!f.areaLayoutAnchor || !isNum(f.areaLayoutAnchor.wPx) || !isNum(f.areaLayoutAnchor.hPx)) {
        stats.missingLayoutAnchor.push(`${fp} (${type})`)
      }
      if (typeof f.rotationDeg !== 'number' || !Number.isFinite(f.rotationDeg)) {
        errors.push(`${fp}: rotationDeg 格式錯誤`)
      }

      const prev = seenIds.get(f.id)
      if (prev) stats.duplicateIds.push(`id ${f.id}: ${prev} vs ${fp}`)
      else seenIds.set(f.id, fp)

      const p = f.parameters ?? {}

      if (POINT_REF_TYPES.has(type)) {
        for (const k of POINT_KEYS) {
          if (!(k in p)) stats.pointMissingKeys.push(`${fp} (${type}) 缺 ${k}`)
          else if (!isNumOrNull(p[k])) errors.push(`${fp}: ${k} 應為 number | null`)
        }
        if (type === 'Signal' && !hasValidPointRef(p)) {
          stats.signalsMissingRef.push(f.customName || f.id)
        }
        if (type === 'Signal') {
          const md = p.mountDirection
          if (!['up', 'down', 'left', 'right'].includes(md)) {
            warnings.push(`${fp}: mountDirection 異常 (${md})`)
          }
        }
      }

      if (BOUNDS_REF_TYPES.has(type)) {
        for (const k of BOUNDS_KEYS) {
          if (!(k in p)) stats.boundsMissingKeys.push(`${fp} (${type}) 缺 ${k}`)
          else if (!isNumOrNull(p[k])) errors.push(`${fp}: ${k} 應為 number | null`)
        }
        if (type === 'Track' && !hasValidBoundsRef(p)) {
          stats.boundsInvalid.push(f.customName || f.id)
        }
      }
    }
  }

  if (stats.duplicateIds.length) {
    errors.push(`重複 facility id: ${stats.duplicateIds.length} 組`)
  }
  if (stats.missingLayoutAnchor.length) {
    warnings.push(`缺少 areaLayoutAnchor: ${stats.missingLayoutAnchor.length} 個`)
  }
  if (stats.pointMissingKeys.length) {
    warnings.push(`單點場域座標缺欄位: ${stats.pointMissingKeys.length} 個`)
  }
  if (stats.boundsMissingKeys.length) {
    warnings.push(`場域範圍缺欄位: ${stats.boundsMissingKeys.length} 個`)
  }
  if (stats.signalsMissingRef.length) {
    warnings.push(
      `號誌尚未設定有效場域座標: ${stats.signalsMissingRef.join(', ')}`,
    )
  }
  if (stats.boundsInvalid.length) {
    warnings.push(
      `軌道場域範圍無效: ${stats.boundsInvalid.slice(0, 10).join(', ')}${stats.boundsInvalid.length > 10 ? '…' : ''}`,
    )
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
    meta: {
      mapId: map.mapId,
      displayName: map.displayName,
      version: map.version,
      updatedAt: map.updatedAt,
      pixelSize: map.pixelSize,
    },
  }
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('用法: node scripts/validate-map-file.mjs <path-to.json>')
  process.exit(1)
}

const result = validate(path.resolve(filePath))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
