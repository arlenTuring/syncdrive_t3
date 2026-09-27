import type { MapLibraryEntry } from '../utils/mapLibraryStorage'
import { resolveMapId } from '../constants/builtinMaps'

const PUBLISH_TOKEN =
  (import.meta as ImportMeta & { env?: { VITE_SYNC_INTERNAL_TOKEN?: string } }).env
    ?.VITE_SYNC_INTERNAL_TOKEN ?? 'sync-dev-internal'

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

export type MapActivationIssue = { code: string; message: string }

/** 設為主要地圖前的檢查結果（規則見後端 map-activation.ts） */
export type MapActivationCheck = {
  mapId: string
  displayName: string | null
  alreadyActive: boolean
  currentActive: { mapId: string; displayName: string | null }
  routeCount: number
  stationCount: number
  deployedShift: { shiftId: string; shiftName: string } | null
  blockers: MapActivationIssue[]
  warnings: MapActivationIssue[]
  canActivate: boolean
}

/**
 * 設為主要地圖前的檢查：部署中的班表在這張地圖上接不接得上。
 * 先把這張的最新內容存上後端，檢查的才是現在這一版。
 */
export async function checkMapActivation(
  entry: MapLibraryEntry,
): Promise<{ ok: true; check: MapActivationCheck } | { ok: false; error: string }> {
  const published = await publishMapLibraryEntryToBackend(entry)
  if (!published.ok) return { ok: false, error: '地圖沒有存到伺服器，請確認後端已啟動' }
  try {
    const res = await fetch(
      `/syncdrive-api/map-activation/${encodeURIComponent(published.mapId)}/check`,
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, check: (await res.json()) as MapActivationCheck }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 設為主要地圖：後端會再檢查一次，不過就回 409 與檢查結果 */
export async function activateMapLibraryEntry(
  entry: MapLibraryEntry,
): Promise<
  | { ok: true; mapId: string }
  | { ok: false; error: string; check?: MapActivationCheck }
> {
  const mapId = mapDocumentMapId(entry)
  try {
    const res = await fetch(`/syncdrive-api/map-activation/${encodeURIComponent(mapId)}`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        libraryId: entry.libraryId,
        displayName: entry.displayName,
        version: entry.version,
        updatedAt: entry.updatedAt,
        mapDocument: entry.mapDocument,
      }),
    })
    if (res.ok) return { ok: true, mapId }
    const body = (await res.json().catch(() => null)) as
      | { message?: string | { message?: string; check?: MapActivationCheck }; check?: MapActivationCheck }
      | null
    const detail = typeof body?.message === 'object' ? body.message : body
    return {
      ok: false,
      error: (typeof detail?.message === 'string' && detail.message) || `HTTP ${res.status}`,
      check: detail?.check,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
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

/**
 * 從後端刪除一份已發佈的地圖。
 *
 * 只刪 localStorage 是不夠的：下次補水就整份回來，使用者以為刪掉了、重整又出現。
 * 使用中的那一份後端會擋（回 403），訊息原樣往上帶。
 */
export async function deletePublishedMap(
  mapId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `/syncdrive-api/map/library/${encodeURIComponent(resolveMapId(mapId))}`,
      { method: 'DELETE', headers: internalHeaders() },
    )
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    return { ok: false, error: body?.message ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
