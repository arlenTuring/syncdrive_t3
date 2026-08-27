import type { MapLibraryEntry } from '../utils/mapLibraryStorage'
import { resolveMapId } from '../constants/builtinMaps'

const PUBLISH_TOKEN =
  import.meta.env.VITE_SYNC_INTERNAL_TOKEN ?? 'sync-dev-internal'

export type MapLibraryBackendStatus = {
  activeMapId: string
  activeLibraryId: string | null
  activeDisplayName: string | null
  maps: Array<{
    mapId: string
    libraryId: string
    displayName: string
    version: string
    updatedAt: string | null
    routeCount?: number
  }>
}

function mapDocumentMapId(entry: MapLibraryEntry): string {
  return resolveMapId(entry.mapDocument.mapId || entry.libraryId)
}

function internalHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Internal-Token': PUBLISH_TOKEN,
  }
}

export async function fetchMapLibraryBackendStatus(): Promise<MapLibraryBackendStatus | null> {
  try {
    const res = await fetch('/syncdrive-api/map/library', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

/**
 * 將地圖庫條目發佈至後端（供模擬器與其他服務讀取）。
 * 失敗時靜默略過，不阻擋本機儲存。
 */
export async function publishMapLibraryEntryToBackend(
  entry: MapLibraryEntry,
): Promise<{ ok: boolean; mapId: string }> {
  const mapId = mapDocumentMapId(entry)
  try {
    const res = await fetch(`/syncdrive-api/map/library/${encodeURIComponent(mapId)}`, {
      method: 'PUT',
      headers: internalHeaders(),
      body: JSON.stringify({
        libraryId: entry.libraryId,
        displayName: entry.displayName,
        version: entry.version,
        updatedAt: entry.updatedAt,
        mapDocument: entry.mapDocument,
      }),
    })
    if (!res.ok) {
      console.warn(`[map-library] publish ${mapId} failed: HTTP ${res.status}`)
      return { ok: false, mapId }
    }
    return { ok: true, mapId }
  } catch (err) {
    console.warn('[map-library] publish failed:', err)
    return { ok: false, mapId }
  }
}

/** 設為當前使用地圖：發佈最新內容並寫入後端 active-map 設定 */
export async function setActiveMapLibraryEntry(
  entry: MapLibraryEntry,
): Promise<{ ok: boolean; mapId: string; error?: string }> {
  const mapId = mapDocumentMapId(entry)
  try {
    const res = await fetch('/syncdrive-api/map/library/active', {
      method: 'PUT',
      headers: internalHeaders(),
      body: JSON.stringify({
        mapId,
        libraryId: entry.libraryId,
        displayName: entry.displayName,
        version: entry.version,
        updatedAt: entry.updatedAt,
        mapDocument: entry.mapDocument,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        ok: false,
        mapId,
        error: text || `HTTP ${res.status}`,
      }
    }
    return { ok: true, mapId }
  } catch (err) {
    return {
      ok: false,
      mapId,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function isMapLibraryEntryActive(
  entry: MapLibraryEntry,
  activeMapId: string | null,
  activeLibraryId: string | null,
): boolean {
  if (activeLibraryId && entry.libraryId === activeLibraryId) return true
  if (!activeMapId) return false
  return mapDocumentMapId(entry) === resolveMapId(activeMapId)
}

export async function fetchPublishedMapDocument(mapId: string): Promise<unknown | null> {
  const resolved = resolveMapId(mapId)
  try {
    const res = await fetch(
      `/syncdrive-api/map/library/${encodeURIComponent(resolved)}`,
      { headers: { Accept: 'application/json' } },
    )
    if (res.ok) {
      const body = await res.json()
      if (body?.mapDocument) return body.mapDocument
    }
    const activeRes = await fetch('/syncdrive-api/map/library/active', {
      headers: { Accept: 'application/json' },
    })
    if (!activeRes.ok) return null
    const active = await activeRes.json()
    if (resolveMapId(active.mapId) !== resolved) return null
    return active.mapDocument ?? null
  } catch {
    return null
  }
}


/** 伺服器上已發佈的地圖 */
export type PublishedMapSummary = {
  mapId: string
  libraryId: string
  displayName: string
  version?: string
  updatedAt?: string
  routeCount?: number
}

/**
 * 伺服器上已發佈的地圖清單。
 *
 * 地圖庫平常讀的是瀏覽器 localStorage——那是<strong>這一台瀏覽器</strong>的東西。
 * 換一台電腦、換一個瀏覽器、清一次快取，看到的就只剩內建範例檔（那份沒有路網拓撲）。
 * 這支讓人把伺服器上真正在用的那份拉回來。
 */
export async function fetchPublishedMapList(): Promise<{
  maps: PublishedMapSummary[]
  activeMapId: string | null
}> {
  const res = await fetch('/syncdrive-api/map/library', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`伺服器回 ${res.status}`)
  const body = await res.json()
  return {
    maps: Array.isArray(body?.maps) ? body.maps : [],
    activeMapId: body?.activeMapId ?? null,
  }
}
