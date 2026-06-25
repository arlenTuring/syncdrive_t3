/**
 * 將 public/maps/*.json 對齊雙座標設計（areaPosition / areaSizePx / areaLayoutAnchor）。
 * 執行：node frontend/scripts/migrate-map-dual-coords.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAPS_DIR = join(__dirname, '../public/maps')

function domainSpan(d) {
  return {
    w: Math.max(0.001, d.xMaxM - d.xMinM),
    h: Math.max(0.001, d.yMaxM - d.yMinM),
  }
}

function meterToAreaLocalPx(xM, yM, domain, layout) {
  const span = domainSpan(domain)
  return {
    x: (xM - domain.xMinM) * (layout.wPx / span.w),
    y: (yM - domain.yMinM) * (layout.hPx / span.h),
  }
}

function meterSizeToAreaLocalPx(wM, hM, domain, layout) {
  const span = domainSpan(domain)
  return {
    w: wM * (layout.wPx / span.w),
    h: hM * (layout.hPx / span.h),
  }
}

function roundN(n, dp = 4) {
  if (!Number.isFinite(n)) return n
  const f = 10 ** dp
  return Math.round(n * f) / f
}

function roundPoint(p) {
  return { x: roundN(p.x), y: roundN(p.y) }
}

function roundSize(s) {
  return { w: roundN(s.w), h: roundN(s.h) }
}

function geofenceSizeFromVertices(vertices) {
  if (!vertices?.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of vertices) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  return { w: maxX - minX, h: maxY - minY }
}

function migrateFacility(f, domain, layout) {
  const pm = f.positionMeters
  if (!pm || typeof pm.x !== 'number' || typeof pm.y !== 'number') {
    throw new Error(`設施 ${f.id}: 缺少 positionMeters`)
  }

  const areaPositionRaw = f.areaPosition ?? f.areaPositionPx
  const areaPosition = roundPoint(
    areaPositionRaw?.x != null && areaPositionRaw?.y != null
      ? { x: areaPositionRaw.x, y: areaPositionRaw.y }
      : meterToAreaLocalPx(pm.x, pm.y, domain, layout),
  )

  let areaSizePx = f.areaSizePx
  if (!areaSizePx?.w || !areaSizePx?.h) {
    if (f.sizeMeters?.w && f.sizeMeters?.h) {
      areaSizePx = meterSizeToAreaLocalPx(
        f.sizeMeters.w,
        f.sizeMeters.h,
        domain,
        layout,
      )
    } else if (f.type === 'Geofence') {
      const verts = f.parameters?.verticesMeters
      const bbox = geofenceSizeFromVertices(verts)
      if (bbox && bbox.w > 0 && bbox.h > 0) {
        areaSizePx = meterSizeToAreaLocalPx(bbox.w, bbox.h, domain, layout)
      }
    }
  }

  const { areaPositionPx: _legacyPos, ...rest } = f
  const next = {
    ...rest,
    positionMeters: roundPoint(pm),
    areaPosition,
    areaLayoutAnchor: {
      wPx: layout.wPx,
      hPx: layout.hPx,
    },
    ...(areaSizePx ? { areaSizePx: roundSize(areaSizePx) } : {}),
    ...(f.sizeMeters
      ? { sizeMeters: roundSize(f.sizeMeters) }
      : {}),
  }
  return next
}

function migrateArea(area) {
  const layout = {
    ...area.layout,
    wPx: Math.max(32, area.layout.wPx),
    hPx: Math.max(32, area.layout.hPx),
  }
  const view = area.view
    ? {
        panXM: area.view.panXM ?? 0,
        panYM: area.view.panYM ?? 0,
        zoom: area.view.zoom ?? 1,
      }
    : { panXM: 0, panYM: 0, zoom: 1 }

  return {
    ...area,
    layout,
    view,
    facilities: (area.facilities ?? []).map((f) =>
      migrateFacility(f, area.domain, layout),
    ),
  }
}

function migrateMap(json) {
  if (json.schemaVersion !== 2) {
    throw new Error('僅支援 schemaVersion 2')
  }
  return {
    ...json,
    areas: (json.areas ?? []).map(migrateArea),
  }
}

const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'))
for (const file of files) {
  const path = join(MAPS_DIR, file)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const migrated = migrateMap(raw)
  writeFileSync(path, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8')
  const count = migrated.areas.flatMap((a) => a.facilities).length
  const withDual = migrated.areas
    .flatMap((a) => a.facilities)
    .filter((f) => f.areaPosition && f.areaLayoutAnchor).length
  console.log(`${file}: ${withDual}/${count} 設施已寫入 areaPosition + areaLayoutAnchor`)
}
