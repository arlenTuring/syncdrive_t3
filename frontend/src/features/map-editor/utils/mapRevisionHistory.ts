/**
 * 地圖編修紀錄（IndexedDB）
 *
 * 設計重點（控記憶體／配额）：
 * - 用 IndexedDB，不占 localStorage 5MB 配額
 * - meta / payload 分 store：清單只讀 meta
 * - autosave 節流 + 內容 hash 去重，避免每次拖曳都寫滿盤
 * - 超過上限時優先刪除舊的 autosave，保留里程碑（進入編輯／手動書籤／正式儲存）
 */

import type {
  MapAreaObject,
  MapPixelOrigin,
  MapPixelSize,
} from '../types/area'
import type { MapFileV2, MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import { buildMapFileV2 } from './mapFileJson'

export const MAP_REVISION_DB_NAME = 'syncdrive-map-revisions-v1'
export const MAP_REVISION_DB_VERSION = 1

/** 每本地圖最多保留幾筆（含里程碑） */
export const MAX_REVISIONS_PER_MAP = 40

/** autosave 最短間隔（毫秒）；里程碑不受此限 */
export const AUTOSAVE_MIN_INTERVAL_MS = 45_000

export type MapRevisionReason =
  | 'autosave'
  | 'session-enter'
  | 'session-save'
  | 'manual-bookmark'

export type MapRevisionSummary = {
  areaCount: number
  facilityCount: number
  routeCount: number
  topologyNodeCount: number
  topologyEdgeCount: number
}

export type MapRevisionMeta = {
  id: string
  libraryId: string
  mapId: string
  createdAt: number
  reason: MapRevisionReason
  label: string
  contentHash: string
  byteSize: number
  summary: MapRevisionSummary
}

export type MapRevisionPayload = {
  mapDocument: MapFileV2
}

export type MapRevisionEditorState = {
  libraryId: string
  mapId: string
  displayName: string
  version: string
  pixelSize: MapPixelSize
  pixelOrigin: MapPixelOrigin
  areas: MapAreaObject[]
  routes: MapPlannedRoute[]
  routeGroups: MapRouteGroup[]
  pointTopology: PointTopology
  visibleRouteIds?: string[]
}

type RecordMapRevisionOptions = {
  reason: MapRevisionReason
  label?: string
  /** 強制寫入（略過 autosave 節流；仍會去重 hash） */
  force?: boolean
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MAP_REVISION_DB_NAME, MAP_REVISION_DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta')) {
        const meta = db.createObjectStore('meta', { keyPath: 'id' })
        meta.createIndex('byLibraryId', 'libraryId', { unique: false })
        meta.createIndex('byLibraryCreated', ['libraryId', 'createdAt'], {
          unique: false,
        })
      }
      if (!db.objectStoreNames.contains('payload')) {
        db.createObjectStore('payload', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB tx failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB tx aborted'))
  })
}

export function buildRevisionSummary(
  areas: MapAreaObject[],
  routes: MapPlannedRoute[],
  pointTopology: PointTopology,
): MapRevisionSummary {
  let facilityCount = 0
  for (const a of areas) facilityCount += a.facilities.length
  return {
    areaCount: areas.length,
    facilityCount,
    routeCount: routes.length,
    topologyNodeCount: pointTopology.nodes.length,
    topologyEdgeCount: pointTopology.edges.length,
  }
}

/** 簡單穩定 hash（FNV-1a 32-bit → hex）；夠用來去重，不必 crypto */
export function hashRevisionContent(json: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function buildRevisionMapDocument(
  state: MapRevisionEditorState,
): MapFileV2 {
  return buildMapFileV2(
    state.mapId || state.libraryId,
    state.displayName,
    state.pixelSize,
    state.areas,
    {
      version: state.version,
      pixelOrigin: state.pixelOrigin,
      routes: state.routes,
      routeGroups: state.routeGroups,
      visibleRouteIds: state.visibleRouteIds ?? [],
      pointTopology: state.pointTopology,
      updatedAt: new Date().toISOString(),
    },
  )
}

export function defaultRevisionLabel(
  reason: MapRevisionReason,
  at = new Date(),
): string {
  const time = at.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  switch (reason) {
    case 'session-enter':
      return `進入編輯 · ${time}`
    case 'session-save':
      return `正式儲存 · ${time}`
    case 'manual-bookmark':
      return `手動書籤 · ${time}`
    default:
      return `自動儲存 · ${time}`
  }
}

export function isMilestoneReason(reason: MapRevisionReason): boolean {
  return reason !== 'autosave'
}

/**
 * 決定刪除哪些 id 以壓回上限。
 * 優先刪最舊的 autosave；若仍超限再刪最舊的非最新一筆。
 */
export function pickRevisionIdsToDelete(
  metas: MapRevisionMeta[],
  maxKeep: number,
): string[] {
  if (metas.length <= maxKeep) return []
  const sorted = [...metas].sort((a, b) => a.createdAt - b.createdAt)
  const toDelete = new Set<string>()
  let remaining = sorted.length

  for (const m of sorted) {
    if (remaining <= maxKeep) break
    if (m.reason === 'autosave') {
      toDelete.add(m.id)
      remaining -= 1
    }
  }

  if (remaining > maxKeep) {
    const newestId = sorted[sorted.length - 1]?.id
    for (const m of sorted) {
      if (remaining <= maxKeep) break
      if (m.id === newestId) continue
      if (toDelete.has(m.id)) continue
      toDelete.add(m.id)
      remaining -= 1
    }
  }

  return [...toDelete]
}

async function listMetaByLibraryId(
  db: IDBDatabase,
  libraryId: string,
): Promise<MapRevisionMeta[]> {
  const tx = db.transaction('meta', 'readonly')
  const index = tx.objectStore('meta').index('byLibraryId')
  const rows = await idbReq(index.getAll(libraryId))
  await txDone(tx)
  return (rows as MapRevisionMeta[]).sort((a, b) => b.createdAt - a.createdAt)
}

async function deleteRevisionsByIds(
  db: IDBDatabase,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const tx = db.transaction(['meta', 'payload'], 'readwrite')
  const metaStore = tx.objectStore('meta')
  const payloadStore = tx.objectStore('payload')
  for (const id of ids) {
    metaStore.delete(id)
    payloadStore.delete(id)
  }
  await txDone(tx)
}

export async function listMapRevisionMetas(
  libraryId: string,
): Promise<MapRevisionMeta[]> {
  if (!libraryId || typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    try {
      return await listMetaByLibraryId(db, libraryId)
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export async function getMapRevisionPayload(
  revisionId: string,
): Promise<MapRevisionPayload | null> {
  if (!revisionId || typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    try {
      const tx = db.transaction('payload', 'readonly')
      const row = await idbReq(
        tx.objectStore('payload').get(revisionId),
      )
      await txDone(tx)
      if (!row || typeof row !== 'object') return null
      const mapDocument = (row as { mapDocument?: MapFileV2 }).mapDocument
      if (!mapDocument) return null
      return { mapDocument }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function deleteMapRevision(revisionId: string): Promise<void> {
  if (!revisionId || typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    try {
      await deleteRevisionsByIds(db, [revisionId])
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
}

export async function clearMapRevisionsForLibrary(
  libraryId: string,
): Promise<void> {
  if (!libraryId || typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    try {
      const metas = await listMetaByLibraryId(db, libraryId)
      await deleteRevisionsByIds(
        db,
        metas.map((m) => m.id),
      )
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
}

/**
 * 寫入一筆編修紀錄。回傳寫入的 meta；若被節流／去重略過則回傳 null。
 */
export async function recordMapRevision(
  state: MapRevisionEditorState,
  options: RecordMapRevisionOptions,
): Promise<MapRevisionMeta | null> {
  if (!state.libraryId || typeof indexedDB === 'undefined') return null

  const mapDocument = buildRevisionMapDocument(state)
  const json = JSON.stringify(mapDocument)
  const contentHash = hashRevisionContent(json)
  const now = Date.now()
  const reason = options.reason
  const force = options.force === true || isMilestoneReason(reason)

  try {
    const db = await openDb()
    try {
      const existing = await listMetaByLibraryId(db, state.libraryId)
      const newest = existing[0]

      if (newest && newest.contentHash === contentHash) {
        return null
      }

      if (
        !force &&
        reason === 'autosave' &&
        newest &&
        now - newest.createdAt < AUTOSAVE_MIN_INTERVAL_MS
      ) {
        return null
      }

      const id = `rev-${now}-${Math.random().toString(36).slice(2, 9)}`
      const meta: MapRevisionMeta = {
        id,
        libraryId: state.libraryId,
        mapId: state.mapId || state.libraryId,
        createdAt: now,
        reason,
        label: options.label?.trim() || defaultRevisionLabel(reason, new Date(now)),
        contentHash,
        byteSize: json.length,
        summary: buildRevisionSummary(
          state.areas,
          state.routes,
          state.pointTopology,
        ),
      }

      const writeTx = db.transaction(['meta', 'payload'], 'readwrite')
      writeTx.objectStore('meta').put(meta)
      writeTx.objectStore('payload').put({ id, mapDocument })
      await txDone(writeTx)

      const after = [meta, ...existing]
      const dropIds = pickRevisionIdsToDelete(after, MAX_REVISIONS_PER_MAP)
      await deleteRevisionsByIds(db, dropIds)

      return meta
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export function formatRevisionByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`
}

export function revisionReasonLabel(reason: MapRevisionReason): string {
  switch (reason) {
    case 'session-enter':
      return '進入編輯'
    case 'session-save':
      return '正式儲存'
    case 'manual-bookmark':
      return '手動書籤'
    default:
      return '自動儲存'
  }
}
