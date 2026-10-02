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
import type { MapBasemapObject } from '../types/basemap'
import { createBlankBasemap } from '../types/basemap'
import type {
  MapFileV2,
  MapPlannedRoute,
  MapRouteGroup,
} from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import { emptyPointTopology } from '../types/pointTopology'
import {
  buildMapFileV2,
  parseMapFileJson,
  type ParsedMapFile,
} from './mapFileJson'
import {
  defaultTrackGenParameters,
} from './trackGenFacility'
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
  /**
   * 這一份有沒有成功送到後端過。
   *
   * 用來分辨「後端上沒有這一張」的兩種情況：<code>pending</code> 是還沒送成功（發佈
   * 失敗、離線），必須留著再送；其餘（已送成功、或舊版沒有這個欄位的資料）代表它
   * 曾經在後端上，現在不在了就是<strong>被刪掉了</strong>，本機要跟著刪。
   */
  publishState?: 'pending' | 'published'
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
      basemaps: parsed.basemaps,
      creationMode: parsed.creationMode,
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
 * 刪除項目後不會自動補回；需要時請重新匯入或建立地圖。
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
 * <h3>比對時間，新的贏</h3>
 * <pre>
 *   後端比較新   → 用後端的覆蓋快取
 *   本機比較新   → 保留本機的，並推上去（本機有還沒發佈的修改）
 *   後端沒有     → 保留本機的並推上去（等於一次自動遷移）
 *   後端連不上   → 沿用快取，畫面照常開
 * </pre>
 *
 * <strong>不能無條件讓後端贏。</strong>本機可能有還沒發佈成功的修改——發佈是
 * 射後不理過的，網路一抖就只留在瀏覽器裡。這時候拉後端那份下來會直接蓋掉人家
 * 剛做完的工作，而且毫無徵兆。
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

  const stamp = (v?: string) => {
    const t = v ? Date.parse(v) : NaN
    return Number.isFinite(t) ? t : 0
  }
  /**
   * 本機比後端新的：<strong>留著，但不要自動推上去</strong>。
   *
   * 「編輯」與「發布」是兩件事。自動推等於使用者一改就上線，沒有一個時點可以說
   * 「我確認過了」——載入時的自動修復若有 bug，也會照樣被推到正式環境。
   *
   * 所以這裡只把它標成未發布：補水時的刪除掃描會因此留著它（見下方 pending 的
   * 例外），編輯器再依這個狀態顯示「有未發布的變更」。要上線得按發布。
   */
  const localNewer: MapLibraryEntry[] = []

  for (const summary of published.maps) {
    const mapId = resolveMapId(summary.mapId || summary.libraryId)
    if (!mapId) continue

    const existing = byId.get(mapId)
    if (existing && stamp(existing.updatedAt) > stamp(summary.updatedAt)) {
      // 本機這份比較新：別動它，標成未發布，等使用者自己按發布
      const pending: MapLibraryEntry = { ...existing, publishState: 'pending' }
      byId.set(mapId, pending)
      localNewer.push(pending)
      continue
    }

    const doc = await fetchPublishedMapDocument(mapId)
    if (!doc) continue
    try {
      const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(doc))
      byId.set(mapId, {
        ...importMapEntryFromServer(parsed, mapId),
        // 內建標記留著：還原內建範例那條路要靠它
        ...(existing?.builtinId ? { builtinId: existing.builtinId } : {}),
      })
    } catch {
      // 後端那份解不開就別動本機的，至少畫面還有東西
    }
  }

  /*
   * 後端沒有的就刪掉，<strong>不要留在本機</strong>。
   *
   * 先前這裡只做聯集：後端有的更新進來，後端沒有的原封不動留著。於是在別處刪掉的
   * 地圖，這台瀏覽器重新整理還是看得到——實測後端只剩 2 張，畫面上照樣列出 30 張，
   * 而且下次存檔還會把它們推回後端，等於刪不掉。使用者要的是「重新整理就是去拉
   * 資料」，那本機就不能有自己的一套。
   *
   * 唯一的例外是還沒送成功的（publishState === 'pending'）：那是本機才有的新東西，
   * 刪掉就真的沒了，留著並且再送一次。舊版資料沒有這個欄位，視同曾經發佈過。
   */
  const liveIds = new Set(
    published.maps.map((m) => resolveMapId(m.mapId || m.libraryId)).filter(Boolean),
  )
  const kept: MapLibraryEntry[] = []
  const dropped: string[] = []
  for (const entry of byId.values()) {
    const mapId = resolveMapId(entry.mapDocument.mapId || entry.libraryId)
    // 內建範例是本機種子出來的，後端上本來就沒有，不能當成被刪掉
    if (liveIds.has(mapId) || entry.publishState === 'pending' || entry.builtinId) {
      kept.push(entry)
    }
    else {
      dropped.push(entry.displayName)
      /*
       * 草稿與正式版的快取也要一起清。
       *
       * 它們是另外幾個 key，只留著地圖不見了也沒人會去讀，但會一直佔配額；更麻煩的
       * 是同一個 libraryId 之後又出現時會把舊草稿當成這張圖的內容。刪除單張時本來
       * 就有清，這條路徑漏了。
       */
      for (const id of [entry.libraryId, entry.builtinId]) {
        if (!id) continue
        localStorage.removeItem(`${MAP_DRAFT_PREFIX}${id}`)
        localStorage.removeItem(`${MAP_OFFICIAL_PREFIX}${id}`)
      }
    }
  }
  if (dropped.length > 0) {
    console.info(`[map-library] 後端已無這些地圖，本機一併清掉：${dropped.join('、')}`)
  }

  const merged = kept
  writeMapLibrary(merged)

  if (localNewer.length > 0) {
    console.info(
      `[map-library] 這幾張本機的比後端新，尚未發布：${localNewer
        .map((e) => e.displayName)
        .join('、')}`,
    )
  }

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
  }
  /*
   * 這裡曾經呼叫 refreshStaleBuiltinMapEntries：內建檔比本機新就用內建檔覆蓋，
   * 或把內建的 refField 併回來。已移除——內建檔是 7 月的，覆蓋等於把使用者
   * 後來做的修改抹掉，而且悄悄地做。要還原內建範例是明確的動作，不該在載入時發生。
   */
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
    basemaps: [],
    routes: [],
    routeGroups: [],
    // 缺欄＝空（不強制全開）——新建的空白地圖還沒有人設定過可視路線，
    // 跟 routes／routeGroups 一樣給空陣列，不是留給執行期猜測。
    visibleRouteIds: [],
    pointTopology: emptyPointTopology(),
    creationMode: 'blank',
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...entryFromParsed(parsed, { libraryId }),
    /*
     * 還沒送上後端。必須標 pending，否則 openLibraryMap 會先 hydrate，
     * 後端沒有這一張就把本機新建的清掉 →「找不到地圖」。
     */
    publishState: 'pending',
  }
}

/** 高精模式：整張畫布鋪滿 TrackGen，不預建 Area；等丟 .xodr 後再生成 */
export function createTrackGenMapEntry(
  pixelSize: MapPixelSize,
  displayName = '未命名地圖',
): MapLibraryEntry {
  const libraryId = generateLibraryId()
  const now = nowIso()
  const basemapId = '1'
  const blank = createBlankBasemap(
    basemapId,
    { x: pixelSize.width / 2, y: pixelSize.height / 2 },
    { w: pixelSize.width, h: pixelSize.height },
  )
  const trackGenBasemap: MapBasemapObject = {
    ...blank,
    customName: '高精地圖',
    layout: {
      xPx: 0,
      yPx: 0,
      wPx: pixelSize.width,
      hPx: pixelSize.height,
    },
    parameters: { ...blank.parameters, ...defaultTrackGenParameters() },
  }
  const parsed: ParsedMapFile = {
    mapId: libraryId,
    displayName,
    version: DEFAULT_MAP_VERSION,
    pixelSize,
    pixelOrigin: { x: 0, y: 0 },
    areas: [],
    basemaps: [trackGenBasemap],
    routes: [],
    routeGroups: [],
    visibleRouteIds: [],
    pointTopology: emptyPointTopology(),
    creationMode: 'trackGen',
    createdAt: now,
    updatedAt: now,
  }
  return {
    ...entryFromParsed(parsed, { libraryId }),
    publishState: 'pending',
  }
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
    // 複製出來的是本機新條目，後端尚無；與新建空白同一規則
    publishState: 'pending',
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
  return {
    ...entryFromParsed(
      { ...parsed, mapId, updatedAt: parsed.updatedAt ?? nowIso() },
      { libraryId: mapId, createdAt: parsed.createdAt },
    ),
    // 這一份就是從後端拿下來的
    publishState: 'published',
  }
}

export function importMapEntryFromParsed(parsed: ParsedMapFile): MapLibraryEntry {
  const libraryId = generateLibraryId()
  const now = nowIso()
  return {
    ...entryFromParsed(
      {
        ...parsed,
        mapId: libraryId,
        createdAt: parsed.createdAt ?? now,
        updatedAt: now,
        version: parsed.version || DEFAULT_MAP_VERSION,
      },
      { libraryId },
    ),
    /*
     * 還沒送上去。標成 pending，補水時才知道「後端沒有這一張」是因為它是新的，
     * 不是因為被刪掉了——不標的話新建的地圖會在下一次重新整理時消失。
     */
    publishState: 'pending',
  }
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
  basemaps: MapBasemapObject[] = [],
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
      basemaps,
      creationMode: entry.mapDocument.creationMode,
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
