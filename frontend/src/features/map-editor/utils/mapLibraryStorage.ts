import {
  BUILTIN_MAPS,
  resolveBuiltinMapIdFromLibraryEntry,
  resolveMapId,
} from '../constants/builtinMaps'
import {
  fetchPublishedMapDocument,
  fetchPublishedMapList,
  publishMapLibraryEntryToBackend,
} from '../api/mapLibraryApi'
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
/**
 * 從後端把地圖庫補回來。
 *
 * <h3>後端是真相，localStorage 只是快取</h3>
 * 地圖庫原本只活在瀏覽器裡：換一台電腦、換一個瀏覽器、換一個網域
 * （localhost ↔ 正式站）就是另一份資料，而且快取空的時候會退回內建範例檔——
 * 那份是 7 月的，連 pointTopology 都沒有。症狀每次換皮出現：路網拓撲不見、
 * 儀表板選不到地圖、編輯器打開是舊版。這與儀表板版面當初的問題是同一個，
 * 那邊已經改成「後端是真相」，這裡比照辦理。
 *
 * <h3>三種情況</h3>
 * <pre>
 *   後端有這張圖   → 用後端的覆蓋快取（本機那份可能是別台機器的舊狀態）
 *   後端沒有       → 保留本機的，並主動推上去（等於一次自動遷移）
 *   後端連不上     → 沿用快取，畫面照常開
 * </pre>
 *
 * 不丟例外：地圖庫打不開比資料舊還糟。回傳的 <code>online</code> 是給畫面用的——
 * 顯示的是後端資料還是本機快取，使用者有權知道。
 */
export async function hydrateMapLibraryFromBackend(): Promise<{
  entries: MapLibraryEntry[]
  online: boolean
}> {
  const local = readMapLibrary()

  let published: Awaited<ReturnType<typeof fetchPublishedMapList>>
  try {
    published = await fetchPublishedMapList()
  } catch {
    return { entries: local, online: false }
  }

  const byId = new Map(local.map((e) => [resolveMapId(e.mapDocument.mapId || e.libraryId), e]))

  for (const summary of published.maps) {
    const mapId = resolveMapId(summary.mapId || summary.libraryId)
    if (!mapId) continue
    const doc = await fetchPublishedMapDocument(mapId)
    if (!doc) continue
    try {
      const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(doc))
      const existing = byId.get(mapId)
      byId.set(mapId, {
        ...importMapEntryFromServer(parsed, mapId),
        // 內建標記留著：還原內建範例那條路要靠它
        ...(existing?.builtinId ? { builtinId: existing.builtinId } : {}),
      })
    } catch {
      // 後端那份解不開就別動本機的，至少畫面還有東西
    }
  }

  const merged = [...byId.values()]
  writeMapLibrary(merged)

  /*
   * 後端是空的＝這台機器還沒遷移過，主動把本機那份推上去。
   *
   * 只寫「下次儲存會送上去」是被動的：使用者不去編輯就永遠不會觸發，
   * 資料就一直只存在這一台瀏覽器裡。
   */
  if (published.maps.length === 0 && merged.length > 0) {
    await Promise.all(merged.map((entry) => publishMapLibraryEntryToBackend(entry)))
  }

  return { entries: merged, online: true }
}

export async function ensureMapLibrarySeeded(): Promise<MapLibraryEntry[]> {
  let entries = readMapLibrary()
  if (entries.length === 0) {
    entries = await seedBuiltinMapLibraryEntries()
    writeMapLibrary(entries)
  } else {
    entries = (await refreshStaleBuiltinMapEntries(entries)).entries
  }
  // 內建墊底之後才問後端：後端有的一律以後端為準
  return (await hydrateMapLibraryFromBackend()).entries
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

/**
 * 從伺服器載回來的地圖。
 *
 * 與 importMapEntryFromParsed 的差別是<strong>保留原本的 mapId</strong>：
 * 那是伺服器上那份的身分。給新 id 的話，同一份地圖每載一次就多一個條目，
 * 而且發佈時會被當成另一張圖。保留 id，重載就是覆蓋。
 */
export function importMapEntryFromServer(
  parsed: ParsedMapFile,
  mapId: string,
): MapLibraryEntry {
  return entryFromParsed(
    { ...parsed, mapId, updatedAt: parsed.updatedAt ?? nowIso() },
    { libraryId: mapId, createdAt: parsed.createdAt },
  )
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
