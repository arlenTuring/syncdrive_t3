import {
  BUILTIN_MAPS,
  resolveBuiltinMapIdFromLibraryEntry,
  resolveMapId,
} from '../constants/builtinMaps'
import { fetchPublishedMapDocument } from '../api/mapLibraryApi'
import {
  createBlankArea,
  type MapAreaObject,
  type MapPixelOrigin,
  type MapPixelSize,
} from '../types/area'
import type { MapFileV2, MapPlannedRoute, MapRouteGroup } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildMapFileV2,
  parseMapFileJson,
  type ParsedMapFile,
} from './mapFileJson'
import {
  getMapOfficialVersion,
  MAP_DRAFT_PREFIX,
  MAP_OFFICIAL_PREFIX,
} from './mapDraftStorage'
import {
  applyRefFieldZeroPolicyToParsed,
  builtinRefFieldsNeedMerge,
  mergeBuiltinRefFieldsIntoParsed,
  mergeBuiltinRefreshPreservingEditorData,
  mergePlatformRefFieldsFromBuiltin,
} from './mergeBuiltinRefFields'

export { mergeBuiltinRefreshPreservingEditorData } from './mergeBuiltinRefFields'

export const MAP_LIBRARY_STORAGE_KEY = 'syncdrive-map-library-v1'
export const DEFAULT_MAP_VERSION = 'v0.0.1'

export type MapLibraryEntry = {
  libraryId: string
  displayName: string
  version: string
  pixelSize: MapPixelSize
  createdAt: string
  updatedAt: string
  /** 若由 public/maps 內建檔種子而來 */
  builtinId?: string
  mapDocument: MapFileV2
}

function nowIso(): string {
  return new Date().toISOString()
}

function generateLibraryId(): string {
  return `map-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function readMapLibrary(): MapLibraryEntry[] {
  try {
    const raw = localStorage.getItem(MAP_LIBRARY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as MapLibraryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeMapLibrary(entries: MapLibraryEntry[]): void {
  try {
    localStorage.setItem(MAP_LIBRARY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* quota / private mode */
  }
}

async function fetchBuiltinJson(path: string): Promise<unknown> {
  const url = new URL(path, window.location.origin).href
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

function entryFromParsed(
  parsed: ParsedMapFile,
  options?: {
    libraryId?: string
    builtinId?: string
    createdAt?: string
    updatedAt?: string
  },
): MapLibraryEntry {
  const libraryId = options?.libraryId ?? parsed.mapId
  const createdAt = options?.createdAt ?? parsed.createdAt ?? nowIso()
  const updatedAt = options?.updatedAt ?? parsed.updatedAt ?? createdAt
  const mapDocument = buildMapFileV2(
    libraryId,
    parsed.displayName,
    parsed.pixelSize,
    parsed.areas,
    {
      description: parsed.description,
      version: parsed.version,
      createdAt,
      updatedAt,
      pixelOrigin: parsed.pixelOrigin,
      routes: parsed.routes,
      routeGroups: parsed.routeGroups,
      visibleRouteIds: parsed.visibleRouteIds,
      pointTopology: parsed.pointTopology,
    },
  )
  return {
    libraryId,
    displayName: parsed.displayName,
    version: parsed.version,
    pixelSize: parsed.pixelSize,
    createdAt,
    updatedAt,
    ...(options?.builtinId ? { builtinId: options.builtinId } : {}),
    mapDocument,
  }
}

function migrateOfficialOverrides(entries: MapLibraryEntry[]): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(MAP_OFFICIAL_PREFIX)) continue
      const mapId = key.slice(MAP_OFFICIAL_PREFIX.length)
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = applyRefFieldZeroPolicyToParsed(
          parseMapFileJson(JSON.parse(raw) as unknown),
        )
        const idx = entries.findIndex(
          (e) => e.libraryId === mapId || e.builtinId === mapId || e.mapDocument.mapId === mapId,
        )
        if (idx >= 0) {
          const prev = entries[idx]!
          const merged = entryFromParsed(parsed, {
            libraryId: prev.libraryId,
            builtinId: prev.builtinId,
            createdAt: prev.createdAt,
          })
          entries[idx] = merged
        } else {
          entries.push(entryFromParsed(parsed, { libraryId: mapId }))
        }
      } catch {
        /* 損毀略過 */
      }
    }
  } catch {
    /* ignore */
  }
}

async function seedBuiltinMapLibraryEntries(): Promise<MapLibraryEntry[]> {
  const entries: MapLibraryEntry[] = []
  for (const meta of BUILTIN_MAPS) {
    if (!meta.path) continue
    try {
      const json = await fetchBuiltinJson(meta.path)
      const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(json))
      entries.push(
        entryFromParsed(parsed, {
          libraryId: meta.id,
          builtinId: meta.id,
        }),
      )
    } catch (e) {
      console.error(`種子內建地圖失敗 (${meta.id}):`, e)
    }
  }
  migrateOfficialOverrides(entries)
  return entries
}

function remoteUpdatedAt(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const v = (json as Record<string, unknown>).updatedAt
  return typeof v === 'string' ? v : ''
}

/**
 * 若 public/maps 內建檔的 updatedAt 較新，覆寫地圖庫中對應 builtin 項目（保留 libraryId）。
 */
export async function refreshStaleBuiltinMapEntries(
  entries: MapLibraryEntry[],
): Promise<{ entries: MapLibraryEntry[]; refreshed: number }> {
  let refreshed = 0
  const next = [...entries]

  for (let i = 0; i < next.length; i++) {
    const entry = next[i]!
    if (!entry.builtinId) continue
    const meta = BUILTIN_MAPS.find((m) => m.id === entry.builtinId)
    if (!meta?.path) continue
    try {
      const json = await fetchBuiltinJson(meta.path)
      const remoteAt = remoteUpdatedAt(json)
      const localAt = entry.mapDocument.updatedAt ?? entry.updatedAt ?? ''
      const remoteParsed = parseMapFileJson(json)
      const localParsed = entryToParsed(entry)
      const remoteIsNewer = Boolean(remoteAt && remoteAt > localAt)
      const needsRefMerge = builtinRefFieldsNeedMerge(localParsed, remoteParsed)
      if (!remoteIsNewer && !needsRefMerge) continue

      const merged = remoteIsNewer
        ? mergeBuiltinRefreshPreservingEditorData(remoteParsed, localParsed)
        : mergeBuiltinRefFieldsIntoParsed(localParsed, remoteParsed)
      const parsed = applyRefFieldZeroPolicyToParsed(merged)
      next[i] = entryFromParsed(parsed, {
        libraryId: entry.libraryId,
        builtinId: entry.builtinId,
        createdAt: entry.createdAt,
        updatedAt: remoteIsNewer ? undefined : entry.updatedAt,
      })
      refreshed++
      if (remoteIsNewer) {
        try {
          // 只清草稿；勿清 official 備份，避免拓撲／路線無法還原
          localStorage.removeItem(`${MAP_DRAFT_PREFIX}${entry.libraryId}`)
          localStorage.removeItem(`${MAP_DRAFT_PREFIX}${entry.builtinId}`)
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.error(`同步內建地圖失敗 (${entry.builtinId}):`, e)
    }
  }

  if (refreshed > 0) writeMapLibrary(next)
  return { entries: next, refreshed }
}

/**
 * 讀取地圖庫。僅在 localStorage 完全空白時種子內建範例；
 * 刪除項目後不會自動補回（請用應用程式設定「還原圖台範例」重載內建地圖）。
 */
export async function ensureMapLibrarySeeded(): Promise<MapLibraryEntry[]> {
  let entries = readMapLibrary()
  if (entries.length === 0) {
    entries = await seedBuiltinMapLibraryEntries()
    writeMapLibrary(entries)
    return entries
  }
  const { entries: synced } = await refreshStaleBuiltinMapEntries(entries)
  return synced
}

export function getMapLibraryEntry(
  libraryId: string,
): MapLibraryEntry | null {
  return readMapLibrary().find((e) => e.libraryId === libraryId) ?? null
}

export function findMapLibraryEntryByMapId(mapId: string): MapLibraryEntry | null {
  return (
    readMapLibrary().find(
      (e) =>
        e.libraryId === mapId ||
        e.mapDocument.mapId === mapId ||
        e.builtinId === mapId,
    ) ?? null
  )
}

export function entryToParsed(entry: MapLibraryEntry): ParsedMapFile {
  return applyRefFieldZeroPolicyToParsed(parseMapFileJson(entry.mapDocument))
}

export function createBlankMapEntry(
  pixelSize: MapPixelSize,
  displayName = '未命名地圖',
): MapLibraryEntry {
  const libraryId = generateLibraryId()
  const now = nowIso()
  const area = createBlankArea('1', pixelSize)
  const parsed: ParsedMapFile = {
    mapId: libraryId,
    displayName,
    version: DEFAULT_MAP_VERSION,
    pixelSize,
    pixelOrigin: { x: 0, y: 0 },
    areas: [area],
    routes: [],
    routeGroups: [],
    // 缺欄＝空（不強制全開）——新建的空白地圖還沒有人設定過可視路線，
    // 跟 routes／routeGroups 一樣給空陣列，不是留給執行期猜測。
    visibleRouteIds: [],
    pointTopology: emptyPointTopology(),
    createdAt: now,
    updatedAt: now,
  }
  return entryFromParsed(parsed, { libraryId })
}

export function duplicateMapEntry(
  entries: MapLibraryEntry[],
  sourceLibraryId: string,
): MapLibraryEntry | null {
  const src = entries.find((e) => e.libraryId === sourceLibraryId)
  if (!src) return null
  const libraryId = generateLibraryId()
  const displayName = `${src.displayName}複製版本`
  const now = nowIso()
  const doc = structuredClone(src.mapDocument)
  doc.mapId = libraryId
  doc.displayName = displayName
  doc.createdAt = now
  doc.updatedAt = now
  return {
    libraryId,
    displayName,
    version: src.version,
    pixelSize: { ...src.pixelSize },
    createdAt: now,
    updatedAt: now,
    mapDocument: doc,
  }
}

export function importMapEntryFromParsed(parsed: ParsedMapFile): MapLibraryEntry {
  const libraryId = generateLibraryId()
  const now = nowIso()
  return entryFromParsed(
    {
      ...parsed,
      mapId: libraryId,
      createdAt: parsed.createdAt ?? now,
      updatedAt: now,
      version: parsed.version || DEFAULT_MAP_VERSION,
    },
    { libraryId },
  )
}

export function renameMapLibraryEntry(
  entries: MapLibraryEntry[],
  libraryId: string,
  displayName: string,
): MapLibraryEntry[] {
  const trimmed = displayName.trim()
  if (!trimmed) return entries
  const now = nowIso()
  return entries.map((e) => {
    if (e.libraryId !== libraryId) return e
    const mapDocument = {
      ...e.mapDocument,
      displayName: trimmed,
      updatedAt: now,
    }
    return {
      ...e,
      displayName: trimmed,
      updatedAt: now,
      mapDocument,
    }
  })
}

export function deleteMapLibraryEntry(
  entries: MapLibraryEntry[],
  libraryId: string,
): MapLibraryEntry[] {
  return entries.filter((e) => e.libraryId !== libraryId)
}

export function upsertMapLibraryEntry(
  entries: MapLibraryEntry[],
  entry: MapLibraryEntry,
): MapLibraryEntry[] {
  const idx = entries.findIndex((e) => e.libraryId === entry.libraryId)
  if (idx < 0) return [...entries, entry]
  const next = [...entries]
  next[idx] = entry
  return next
}

export function saveEditorStateToLibraryEntry(
  entry: MapLibraryEntry,
  meta: {
    displayName: string
    version: string
    pixelSize: MapPixelSize
    pixelOrigin: MapPixelOrigin
  },
  areas: MapAreaObject[],
  routes: MapPlannedRoute[] = [],
  routeGroups: MapRouteGroup[] = [],
  pointTopology?: PointTopology,
  visibleRouteIds: readonly string[] = [],
): MapLibraryEntry {
  const now = nowIso()
  const mapDocument = buildMapFileV2(
    entry.libraryId,
    meta.displayName.trim() || entry.displayName,
    meta.pixelSize,
    areas,
    {
      description: entry.mapDocument.description,
      version: meta.version.trim() || DEFAULT_MAP_VERSION,
      createdAt: entry.createdAt,
      updatedAt: now,
      pixelOrigin: meta.pixelOrigin,
      routes,
      routeGroups,
      visibleRouteIds: [...visibleRouteIds],
      pointTopology,
    },
  )
  return {
    ...entry,
    displayName: mapDocument.displayName,
    version: mapDocument.version ?? DEFAULT_MAP_VERSION,
    pixelSize: meta.pixelSize,
    updatedAt: now,
    mapDocument,
  }
}

/** 供儀表板／預覽：依 mapId 取得 JSON（優先地圖庫，其次 legacy official，最後內建檔） */
export async function resolveMapJsonByMapId(mapId: string): Promise<{
  json: unknown
  source: 'library' | 'official' | 'builtin'
} | null> {
  const resolvedMapId = resolveMapId(mapId)

  const fromBackend = await fetchPublishedMapDocument(resolvedMapId)
  if (fromBackend) {
    return { json: fromBackend, source: 'library' }
  }

  const fromLibrary = findMapLibraryEntryByMapId(resolvedMapId)
  if (fromLibrary) {
    return { json: fromLibrary.mapDocument, source: 'library' }
  }

  const official = getMapOfficialVersion(resolvedMapId)
  if (official) {
    return { json: JSON.parse(official) as unknown, source: 'official' }
  }

  const builtin = BUILTIN_MAPS.find((m) => m.id === resolvedMapId)
  if (builtin?.path) {
    const json = await fetchBuiltinJson(builtin.path)
    return { json, source: 'builtin' }
  }

  return null
}

async function mergePlatformFromBuiltinPath(
  parsed: ParsedMapFile,
  builtinPath: string,
): Promise<ParsedMapFile> {
  try {
    const json = await fetchBuiltinJson(builtinPath)
    const remoteParsed = parseMapFileJson(json)
    return applyRefFieldZeroPolicyToParsed(
      mergePlatformRefFieldsFromBuiltin(parsed, remoteParsed),
    )
  } catch {
    return parsed
  }
}

/** 圖台／儀表板：解析地圖並強制合併 Track refField（MQTT 定位必需） */
export async function resolveParsedMapForPlatform(mapId: string) {
  const resolvedMapId = resolveMapId(mapId)
  const builtinMeta = BUILTIN_MAPS.find((m) => m.id === resolvedMapId && m.path)

  const fromBackend = await fetchPublishedMapDocument(resolvedMapId)
  if (fromBackend) {
    let parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(fromBackend))
    if (builtinMeta?.path) {
      parsed = await mergePlatformFromBuiltinPath(parsed, builtinMeta.path)
    }
    return parsed
  }

  const fromLibrary = findMapLibraryEntryByMapId(resolvedMapId)
  if (fromLibrary) {
    let parsed = entryToParsed(fromLibrary)
    const builtinId =
      fromLibrary.builtinId ?? resolveBuiltinMapIdFromLibraryEntry(fromLibrary)
    const meta =
      BUILTIN_MAPS.find((m) => m.id === builtinId && m.path) ?? builtinMeta
    if (meta?.path) {
      parsed = await mergePlatformFromBuiltinPath(parsed, meta.path)
    }
    return parsed
  }

  if (builtinMeta?.path) {
    try {
      const json = await fetchBuiltinJson(builtinMeta.path)
      return applyRefFieldZeroPolicyToParsed(parseMapFileJson(json))
    } catch {
      /* fall through */
    }
  }

  const resolved = await resolveMapJsonByMapId(resolvedMapId)
  if (!resolved) return null
  let parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(resolved.json))
  if (builtinMeta?.path) {
    parsed = await mergePlatformFromBuiltinPath(parsed, builtinMeta.path)
  }
  return parsed
}

/**
 * 還原內建範例：重載「軌道合併加道路線」（帶 builtinId），不刪除使用者自建／複製地圖。
 * 同時清除內建 mapId 的 draft／legacy official 覆寫。
 */
export async function restoreBuiltinMapLibraryEntries(): Promise<number> {
  let entries = readMapLibrary()
  if (entries.length === 0) {
    entries = await seedBuiltinMapLibraryEntries()
    writeMapLibrary(entries)
    return entries.filter((e) => e.builtinId).length
  }

  let restored = 0
  const next = [...entries]

  for (let i = 0; i < next.length; i++) {
    const entry = next[i]!
    if (!entry.builtinId) continue
    const meta = BUILTIN_MAPS.find((m) => m.id === entry.builtinId)
    if (!meta?.path) continue
    try {
      const json = await fetchBuiltinJson(meta.path)
      const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(json))
      next[i] = entryFromParsed(parsed, {
        libraryId: entry.libraryId,
        builtinId: entry.builtinId,
        createdAt: entry.createdAt,
      })
      restored++
      try {
        localStorage.removeItem(`${MAP_DRAFT_PREFIX}${entry.libraryId}`)
        localStorage.removeItem(`${MAP_DRAFT_PREFIX}${entry.builtinId}`)
        localStorage.removeItem(`${MAP_OFFICIAL_PREFIX}${entry.libraryId}`)
        localStorage.removeItem(`${MAP_OFFICIAL_PREFIX}${entry.builtinId}`)
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.error(`還原內建地圖失敗 (${entry.builtinId}):`, e)
    }
  }

  for (const meta of BUILTIN_MAPS) {
    if (!meta.path) continue
    if (next.some((e) => e.builtinId === meta.id)) continue
    try {
      const json = await fetchBuiltinJson(meta.path)
      const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(json))
      next.push(
        entryFromParsed(parsed, {
          libraryId: meta.id,
          builtinId: meta.id,
        }),
      )
      restored++
    } catch (e) {
      console.error(`補上內建範例失敗 (${meta.id}):`, e)
    }
  }

  writeMapLibrary(next)
  return restored
}

export function formatMapLibraryDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
