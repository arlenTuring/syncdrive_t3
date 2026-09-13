import {
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  CloudDownload,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MapPixelSize } from '../types/area'
import type { MapCreationMode } from '../types/mapFile'
import { sanitizeMapExportFilename } from '../utils/mapExportFilename'
import { parseMapFileJson } from '../utils/mapFileJson'
import { applyRefFieldZeroPolicyToParsed } from '../utils/mergeBuiltinRefFields'
import {
  createBlankMapEntry,
  createTrackGenMapEntry,
  deleteMapLibraryEntry,
  duplicateMapEntry,
  ensureMapLibrarySeeded,
  hydrateMapLibraryFromBackend,
  formatMapLibraryDate,
  importMapEntryFromParsed,
  importMapEntryFromServer,
  readMapLibrary,
  renameMapLibraryEntry,
  upsertMapLibraryEntry,
  writeMapLibrary,
  type MapLibraryEntry,
} from '../utils/mapLibraryStorage'
import { clearMapRevisionsForLibrary } from '../utils/mapRevisionHistory'
import { NewMapPixelDialog } from './NewMapPixelDialog'
import { BackToHomeButton } from '../../../components/BackToHomeButton'
import {
  fetchMapLibraryBackendStatus,
  deletePublishedMap,
  fetchPublishedMapDocument,
  fetchPublishedMapList,
  isMapLibraryEntryActive,
  publishMapLibraryEntryToBackend,
  setActiveMapLibraryEntry,
  type PublishedMapSummary,
} from '../api/mapLibraryApi'

type MapLibraryPageProps = {
  onOpenMap: (libraryId: string) => void
  onBackToHome?: () => void
}

export function MapLibraryPage({ onOpenMap, onBackToHome }: MapLibraryPageProps) {
  const { t } = useTranslation()
  const pasteAreaId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<MapLibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newMapDialogOpen, setNewMapDialogOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [serverMaps, setServerMaps] = useState<PublishedMapSummary[] | null>(null)
  const [serverActiveId, setServerActiveId] = useState<string | null>(null)
  const [serverLoadingId, setServerLoadingId] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [activeMapId, setActiveMapId] = useState<string | null>(null)
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null)
  const [activatingLibraryId, setActivatingLibraryId] = useState<string | null>(
    null,
  )

  const refreshActiveStatus = useCallback(async () => {
    const status = await fetchMapLibraryBackendStatus()
    if (!status) return
    setActiveMapId(status.activeMapId)
    setActiveLibraryId(status.activeLibraryId)
  }, [])

  /**
   * 先畫快取，再跟後端對。
   *
   * 快取是快取，不是真相——但等 33 毫秒才畫第一幀也沒必要。所以先把本機那份放上去，
   * 補水完成再換掉。<strong>後端連不上時要標出來</strong>：悄悄顯示舊資料正是先前
   * 那一串「存了又還原」「拓撲不見了」的形狀。
   */
  const refreshEntries = useCallback(async () => {
    const cached = readMapLibrary()
    if (cached.length > 0) setEntries(cached)
    setLoading(cached.length === 0)
    setError(null)
    try {
      await ensureMapLibrarySeeded()
      const { entries, online } = await hydrateMapLibraryFromBackend()
      setEntries(entries)
      setOffline(!online)
      await refreshActiveStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries(readMapLibrary())
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [refreshActiveStatus])

  useEffect(() => {
    void refreshEntries()
  }, [refreshEntries])

  const persistEntries = useCallback((next: MapLibraryEntry[]) => {
    writeMapLibrary(next)
    setEntries(next)
  }, [])

  /** 地圖名稱／內容必須上後端；清單以伺服器為準，禁止只改本機。 */
  const syncEntryToBackend = useCallback(
    async (
      entry: MapLibraryEntry,
      options?: { updateActive?: boolean },
    ): Promise<{ ok: boolean; error?: string }> => {
      const published = await publishMapLibraryEntryToBackend(entry)
      if (!published.ok) {
        return {
          ok: false,
          error: t('mapLibrary.backendRequired'),
        }
      }
      const shouldUpdateActive =
        options?.updateActive
        ?? isMapLibraryEntryActive(entry, activeMapId, activeLibraryId)
      if (shouldUpdateActive) {
        const active = await setActiveMapLibraryEntry(entry)
        if (!active.ok) {
          return {
            ok: false,
            error: active.error ?? t('mapLibrary.backendRequired'),
          }
        }
        await refreshActiveStatus()
      }
      return { ok: true }
    },
    [activeLibraryId, activeMapId, refreshActiveStatus, t],
  )

  const handleCreateMap = useCallback(
    async (pixelSize: MapPixelSize, creationMode: MapCreationMode) => {
      setNewMapDialogOpen(false)
      const entry =
        creationMode === 'trackGen'
          ? createTrackGenMapEntry(pixelSize)
          : createBlankMapEntry(pixelSize)
      const synced = await publishMapLibraryEntryToBackend(entry)
      const stored: MapLibraryEntry = {
        ...entry,
        publishState: synced.ok ? 'published' : 'pending',
      }
      persistEntries(upsertMapLibraryEntry(readMapLibrary(), stored))
      if (!synced.ok) {
        alert(t('mapLibrary.publishFailed', { error: t('mapLibrary.backendRequired') }))
      }
      onOpenMap(entry.libraryId)
    },
    [onOpenMap, persistEntries, t],
  )

  const handleDuplicate = useCallback(
    async (libraryId: string) => {
      const nextLib = readMapLibrary()
      const copy = duplicateMapEntry(nextLib, libraryId)
      if (!copy) return
      const synced = await publishMapLibraryEntryToBackend(copy)
      const stored: MapLibraryEntry = {
        ...copy,
        publishState: synced.ok ? 'published' : 'pending',
      }
      persistEntries(upsertMapLibraryEntry(readMapLibrary(), stored))
      if (!synced.ok) {
        alert(t('mapLibrary.publishFailed', { error: t('mapLibrary.backendRequired') }))
      }
    },
    [persistEntries, t],
  )

  const startRename = useCallback((entry: MapLibraryEntry) => {
    setRenamingId(entry.libraryId)
    setRenameDraft(entry.displayName)
  }, [])

  const commitRename = useCallback(
    async (libraryId: string) => {
      const trimmed = renameDraft.trim()
      const current = readMapLibrary()
      const prev = current.find((e) => e.libraryId === libraryId)
      setRenamingId(null)
      setRenameDraft('')
      if (!prev || !trimmed || trimmed === prev.displayName) return

      const next = renameMapLibraryEntry(current, libraryId, trimmed)
      const entry = next.find((e) => e.libraryId === libraryId)
      if (!entry) return

      const sync = await syncEntryToBackend(entry)
      if (!sync.ok) {
        alert(
          t('mapLibrary.renameSyncFailed', {
            error: sync.error ?? t('mapLibrary.backendRequired'),
          }),
        )
        return
      }
      persistEntries(
        next.map((e) =>
          e.libraryId === libraryId ? { ...e, publishState: 'published' as const } : e,
        ),
      )
    },
    [persistEntries, renameDraft, syncEntryToBackend, t],
  )

  const handleDelete = useCallback(
    async (entry: MapLibraryEntry) => {
      const label = entry.builtinId
        ? t('mapLibrary.builtinExample')
        : t('mapLibrary.mapLabel')
      if (
        !window.confirm(
          t('mapLibrary.confirmDelete', {
            label,
            name: entry.displayName,
          }),
        )
      ) {
        return
      }

      /*
       * 後端也要刪。
       *
       * 只刪 localStorage 的話，下次跟後端補水就整份回來——使用者以為刪掉了，
       * 重整又出現。後端擋下來（例如使用中的地圖）時就不要刪本機那份，
       * 否則兩邊會不一致。
       */
      const mapId = entry.mapDocument.mapId || entry.libraryId
      const result = await deletePublishedMap(mapId)
      if (!result.ok) {
        alert(
          t('mapLibrary.deleteFailed', {
            error: result.error ?? t('mapLibrary.backendRejected'),
          }),
        )
        return
      }

      persistEntries(deleteMapLibraryEntry(readMapLibrary(), entry.libraryId))
      void clearMapRevisionsForLibrary(entry.libraryId)
    },
    [persistEntries, t],
  )

  const handleExport = useCallback((entry: MapLibraryEntry) => {
    const blob = new Blob([JSON.stringify(entry.mapDocument, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = sanitizeMapExportFilename(entry.displayName)
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const importParsed = useCallback(
    async (parsed: ReturnType<typeof parseMapFileJson>) => {
      const entry = importMapEntryFromParsed(parsed)
      const synced = await publishMapLibraryEntryToBackend(entry)
      const stored: MapLibraryEntry = {
        ...entry,
        publishState: synced.ok ? 'published' : 'pending',
      }
      persistEntries(upsertMapLibraryEntry(readMapLibrary(), stored))
      setPasteOpen(false)
      setPasteText('')
      if (!synced.ok) {
        alert(t('mapLibrary.publishFailed', { error: t('mapLibrary.backendRequired') }))
      }
    },
    [persistEntries, t],
  )

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const json = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
        importParsed(applyRefFieldZeroPolicyToParsed(parseMapFileJson(json)))
      } catch (e) {
        alert(
          t('mapLibrary.importFailed', {
            error: e instanceof Error ? e.message : String(e),
          }),
        )
      }
    },
    [importParsed, t],
  )

  /**
   * 從伺服器把已發佈的地圖拉回這一台瀏覽器的地圖庫。
   *
   * 地圖庫存在 localStorage，是<strong>每個瀏覽器各自一份</strong>。在別台電腦編好的
   * 地圖，這裡看不到；localStorage 空的時候還會退回內建範例檔——那份沒有路網拓撲，
   * 於是拓撲看起來像是不見了。
   *
   * 拉回來會<strong>覆蓋</strong>同 mapId 的既有條目，不是新增一份。載之前先問清楚：
   * 這一步會蓋掉本機還沒發佈的修改。
   */
  const handleLoadFromServer = useCallback(
    async (summary: PublishedMapSummary) => {
      setServerLoadingId(summary.mapId)
      try {
        const doc = await fetchPublishedMapDocument(summary.mapId)
        if (!doc) throw new Error(t('mapLibrary.serverDocMissing'))
        const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(doc))
        const existing = readMapLibrary().find(
          (e) => e.libraryId === summary.mapId || e.mapDocument.mapId === summary.mapId,
        )
        if (
          existing
          && !window.confirm(
            t('mapLibrary.confirmOverwrite', { name: existing.displayName }),
          )
        ) {
          return
        }
        const entry = importMapEntryFromServer(parsed, summary.mapId)
        persistEntries(upsertMapLibraryEntry(readMapLibrary(), entry))
        setServerOpen(false)
      } catch (e) {
        alert(
          t('mapLibrary.loadFromServerFailed', {
            error: e instanceof Error ? e.message : String(e),
          }),
        )
      } finally {
        setServerLoadingId(null)
      }
    },
    [persistEntries, t],
  )

  const handleOpenServerList = useCallback(async () => {
    if (serverOpen) {
      setServerOpen(false)
      return
    }
    setServerOpen(true)
    setServerMaps(null)
    setServerError(null)
    try {
      const { maps, activeMapId } = await fetchPublishedMapList()
      setServerMaps(maps)
      setServerActiveId(activeMapId)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e))
    }
  }, [serverOpen])

  const handlePasteImport = useCallback(() => {
    try {
      const json = JSON.parse(pasteText.replace(/^\uFEFF/, '')) as unknown
      importParsed(applyRefFieldZeroPolicyToParsed(parseMapFileJson(json)))
    } catch (e) {
      alert(
        t('mapLibrary.importFailed', {
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }, [importParsed, pasteText, t])

  const handleSetActive = useCallback(
    async (entry: MapLibraryEntry) => {
      if (isMapLibraryEntryActive(entry, activeMapId, activeLibraryId)) return
      setActivatingLibraryId(entry.libraryId)
      try {
        const result = await setActiveMapLibraryEntry(entry)
        if (!result.ok) {
          alert(
            t('mapLibrary.setActiveFailed', {
              error: result.error ?? t('mapLibrary.backendRequired'),
            }),
          )
          return
        }
        setActiveMapId(result.mapId)
        setActiveLibraryId(entry.libraryId)
      } finally {
        setActivatingLibraryId(null)
      }
    },
    [activeLibraryId, activeMapId, t],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-800 bg-zinc-900/90 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {onBackToHome && (
              <BackToHomeButton onClick={onBackToHome} className="mt-0.5" />
            )}
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
                {t('mapLibrary.title')}
                {offline && (
                  <span
                    title={t('mapLibrary.offlineTitle')}
                    className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] font-normal text-amber-300"
                  >
                    {t('mapLibrary.offline')}
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                {t('mapLibrary.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setNewMapDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-3 py-1.5 text-sm font-medium text-cyan-200 hover:bg-cyan-900/50"
            >
              <Plus className="size-4" aria-hidden />
              {t('mapLibrary.newBlank')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleImportFile(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <FolderOpen className="size-4" aria-hidden />
              {t('mapLibrary.importFile')}
            </button>
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <FileText className="size-4" aria-hidden />
              {t('mapLibrary.pasteFile')}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenServerList()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <CloudDownload className="size-4" aria-hidden />
              {t('mapLibrary.loadFromServer')}
            </button>
          </div>
        </div>

        {serverOpen && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <p className="text-xs text-zinc-400">
              {t('mapLibrary.serverHintBefore')}
              <span className="text-zinc-300">{t('mapLibrary.serverHintEmphasis')}</span>
              {t('mapLibrary.serverHintAfter')}
            </p>

            {serverError ? (
              <p className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
                {t('mapLibrary.serverListFailed', { error: serverError })}
              </p>
            ) : serverMaps === null ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t('mapLibrary.serverLoading')}
              </p>
            ) : serverMaps.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">{t('mapLibrary.serverEmpty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-800">
                {serverMaps.map((m) => (
                  <li key={m.mapId} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-100">
                        {m.displayName}
                        {m.mapId === serverActiveId ? (
                          <span className="ml-2 rounded border border-cyan-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                            {t('mapLibrary.inUse')}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {m.mapId} · {m.version ?? t('mapLibrary.noVersion')}
                        {m.updatedAt ? ` · ${formatMapLibraryDate(m.updatedAt)}` : ''}
                        {typeof m.routeCount === 'number'
                          ? ` · ${t('mapLibrary.routeCount', { count: m.routeCount })}`
                          : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={serverLoadingId != null}
                      onClick={() => void handleLoadFromServer(m)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-700/60 bg-cyan-950/50 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-40"
                    >
                      {serverLoadingId === m.mapId ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <CloudDownload className="size-3.5" aria-hidden />
                      )}
                      {t('mapLibrary.load')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pasteOpen && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <label htmlFor={pasteAreaId} className="text-xs text-zinc-400">
              {t('mapLibrary.pasteLabel')}
            </label>
            <textarea
              id={pasteAreaId}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-500"
              placeholder='{"schemaVersion":2,"mapId":"...", ...}'
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false)
                  setPasteText('')
                }}
                className="rounded-md border border-zinc-600 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handlePasteImport}
                className="rounded-md border border-cyan-700 bg-cyan-950/60 px-3 py-1 text-sm text-cyan-100 hover:bg-cyan-900/50"
              >
                {t('mapLibrary.import')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-400">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            {t('mapLibrary.loading')}
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-zinc-500">{t('mapLibrary.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.version')}</th>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.resolution')}</th>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.createdAt')}</th>
                  <th className="px-4 py-3 font-medium">{t('mapLibrary.columns.updatedAt')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('mapLibrary.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {entries.map((entry) => {
                  const isActive = isMapLibraryEntryActive(
                    entry,
                    activeMapId,
                    activeLibraryId,
                  )
                  const isActivating = activatingLibraryId === entry.libraryId
                  return (
                  <tr
                    key={entry.libraryId}
                    className={isActive ? 'bg-cyan-950/20 hover:bg-cyan-950/30' : 'hover:bg-zinc-900/50'}
                  >
                    <td className="px-4 py-3">
                      {renamingId === entry.libraryId ? (
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => commitRename(entry.libraryId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(entry.libraryId)
                            if (e.key === 'Escape') {
                              setRenamingId(null)
                              setRenameDraft('')
                            }
                          }}
                          autoFocus
                          className="w-full min-w-[10rem] rounded border border-cyan-600 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-zinc-100">
                            {entry.displayName}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              entry.mapDocument.creationMode === 'trackGen'
                                ? 'bg-emerald-950/70 text-emerald-300/90'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {entry.mapDocument.creationMode === 'trackGen'
                              ? t('mapLibrary.modeTrackGen')
                              : t('mapLibrary.modeBlank')}
                          </span>
                          {entry.builtinId && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              {t('mapLibrary.builtin')}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/50 bg-cyan-950/50 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          {t('mapLibrary.inUse')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {entry.version}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {entry.pixelSize.width}×{entry.pixelSize.height}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {formatMapLibraryDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {formatMapLibraryDate(entry.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {!isActive ? (
                          <button
                            type="button"
                            onClick={() => void handleSetActive(entry)}
                            disabled={isActivating}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-600/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
                            title={t('mapLibrary.setActiveTitle')}
                          >
                            {isActivating ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                            ) : (
                              <MapPin className="size-3" aria-hidden />
                            )}
                            {t('mapLibrary.setActive')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onOpenMap(entry.libraryId)}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-700/60 bg-cyan-950/40 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/50"
                          title={t('mapLibrary.openTitle')}
                        >
                          {t('mapLibrary.open')}
                        </button>
                        <button
                          type="button"
                          onClick={() => startRename(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title={t('mapLibrary.renameTitle')}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(entry.libraryId)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title={t('mapLibrary.duplicateTitle')}
                        >
                          <Copy className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title={t('mapLibrary.exportTitle')}
                        >
                          <Download className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300"
                          title={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewMapPixelDialog
        open={newMapDialogOpen}
        onConfirm={handleCreateMap}
        onCancel={() => setNewMapDialogOpen(false)}
      />
    </div>
  )
}
