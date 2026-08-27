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
import type { MapPixelSize } from '../types/area'
import { sanitizeMapExportFilename } from '../utils/mapExportFilename'
import { parseMapFileJson } from '../utils/mapFileJson'
import { applyRefFieldZeroPolicyToParsed } from '../utils/mergeBuiltinRefFields'
import {
  createBlankMapEntry,
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
  setActiveMapLibraryEntry,
  type PublishedMapSummary,
} from '../api/mapLibraryApi'

type MapLibraryPageProps = {
  onOpenMap: (libraryId: string) => void
  onBackToHome?: () => void
}

export function MapLibraryPage({ onOpenMap, onBackToHome }: MapLibraryPageProps) {
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

  const handleCreateBlank = useCallback(
    (pixelSize: MapPixelSize) => {
      setNewMapDialogOpen(false)
      const entry = createBlankMapEntry(pixelSize)
      const next = upsertMapLibraryEntry(readMapLibrary(), entry)
      persistEntries(next)
      onOpenMap(entry.libraryId)
    },
    [onOpenMap, persistEntries],
  )

  const handleDuplicate = useCallback(
    (libraryId: string) => {
      const nextLib = readMapLibrary()
      const copy = duplicateMapEntry(nextLib, libraryId)
      if (!copy) return
      persistEntries(upsertMapLibraryEntry(nextLib, copy))
    },
    [persistEntries],
  )

  const startRename = useCallback((entry: MapLibraryEntry) => {
    setRenamingId(entry.libraryId)
    setRenameDraft(entry.displayName)
  }, [])

  const commitRename = useCallback(
    (libraryId: string) => {
      const next = renameMapLibraryEntry(readMapLibrary(), libraryId, renameDraft)
      persistEntries(next)
      setRenamingId(null)
      setRenameDraft('')
    },
    [persistEntries, renameDraft],
  )

  const handleDelete = useCallback(
    async (entry: MapLibraryEntry) => {
      const label = entry.builtinId ? '內建範例' : '地圖'
      if (
        !window.confirm(
          `確定要刪除${label}「${entry.displayName}」？\n\n此操作無法復原。`,
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
        alert(`刪不掉：${result.error ?? '後端拒絕'}`)
        return
      }

      persistEntries(deleteMapLibraryEntry(readMapLibrary(), entry.libraryId))
      void clearMapRevisionsForLibrary(entry.libraryId)
    },
    [persistEntries],
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
    (parsed: ReturnType<typeof parseMapFileJson>) => {
      const entry = importMapEntryFromParsed(parsed)
      persistEntries(upsertMapLibraryEntry(readMapLibrary(), entry))
      setPasteOpen(false)
      setPasteText('')
    },
    [persistEntries],
  )

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const json = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
        importParsed(applyRefFieldZeroPolicyToParsed(parseMapFileJson(json)))
      } catch (e) {
        alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [importParsed],
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
        if (!doc) throw new Error('伺服器上找不到這份地圖的內容')
        const parsed = applyRefFieldZeroPolicyToParsed(parseMapFileJson(doc))
        const existing = readMapLibrary().find(
          (e) => e.libraryId === summary.mapId || e.mapDocument.mapId === summary.mapId,
        )
        if (
          existing
          && !window.confirm(
            `地圖庫裡已經有「${existing.displayName}」。\n`
            + '從伺服器載入會覆蓋它，本機還沒發佈的修改會消失。要繼續嗎？',
          )
        ) {
          return
        }
        const entry = importMapEntryFromServer(parsed, summary.mapId)
        persistEntries(upsertMapLibraryEntry(readMapLibrary(), entry))
        setServerOpen(false)
      } catch (e) {
        alert(`從伺服器載入失敗：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setServerLoadingId(null)
      }
    },
    [persistEntries],
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
      alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [importParsed, pasteText])

  const handleSetActive = useCallback(
    async (entry: MapLibraryEntry) => {
      if (isMapLibraryEntryActive(entry, activeMapId, activeLibraryId)) return
      setActivatingLibraryId(entry.libraryId)
      try {
        const result = await setActiveMapLibraryEntry(entry)
        if (!result.ok) {
          alert(
            `設為當前使用地圖失敗：${result.error ?? '請確認後端已啟動'}`,
          )
          return
        }
        setActiveMapId(result.mapId)
        setActiveLibraryId(entry.libraryId)
      } finally {
        setActivatingLibraryId(null)
      }
    },
    [activeLibraryId, activeMapId],
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
                地圖清單
                {offline && (
                  <span
                    title="連不上伺服器，顯示的是這台瀏覽器的快取，可能不是最新的"
                    className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] font-normal text-amber-300"
                  >
                    離線
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                選擇要編輯的地圖，或建立空白地圖、複製、匯入／導出地圖描述檔。
                「設為當前使用」後，儀表板模擬與後端 API 會讀取該圖。
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
              新建空白地圖
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
              匯入地圖描述檔
            </button>
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <FileText className="size-4" aria-hidden />
              貼上地圖描述檔
            </button>
            <button
              type="button"
              onClick={() => void handleOpenServerList()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              <CloudDownload className="size-4" aria-hidden />
              從伺服器載入
            </button>
          </div>
        </div>

        {serverOpen && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <p className="text-xs text-zinc-400">
              伺服器上已發佈的地圖。載回來會覆蓋地圖庫裡同一份地圖，
              <span className="text-zinc-300">本機還沒發佈的修改會消失</span>。
            </p>

            {serverError ? (
              <p className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
                讀不到清單：{serverError}
              </p>
            ) : serverMaps === null ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                讀取中…
              </p>
            ) : serverMaps.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">伺服器上還沒有任何已發佈的地圖。</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-800">
                {serverMaps.map((m) => (
                  <li key={m.mapId} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-100">
                        {m.displayName}
                        {m.mapId === serverActiveId ? (
                          <span className="ml-2 rounded border border-cyan-800 px-1.5 py-0.5 text-[10px] text-cyan-300">
                            使用中
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {m.mapId} · {m.version ?? '無版本'}
                        {m.updatedAt ? ` · ${formatMapLibraryDate(m.updatedAt)}` : ''}
                        {typeof m.routeCount === 'number' ? ` · ${m.routeCount} 條路線` : ''}
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
                      載入
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
              貼上地圖描述檔內容（schemaVersion 2）
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
                取消
              </button>
              <button
                type="button"
                onClick={handlePasteImport}
                className="rounded-md border border-cyan-700 bg-cyan-950/60 px-3 py-1 text-sm text-cyan-100 hover:bg-cyan-900/50"
              >
                匯入
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-400">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            載入地圖清單…
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-zinc-500">尚無地圖，請建立或匯入。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">名稱</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 font-medium">版本</th>
                  <th className="px-4 py-3 font-medium">目標解析度</th>
                  <th className="px-4 py-3 font-medium">建立日期</th>
                  <th className="px-4 py-3 font-medium">修改日期</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
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
                          {entry.builtinId && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              內建
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/50 bg-cyan-950/50 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          使用中
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
                            title="設為當前使用地圖（同步至後端，供模擬器與 API 讀取）"
                          >
                            {isActivating ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                            ) : (
                              <MapPin className="size-3" aria-hidden />
                            )}
                            設為當前使用
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onOpenMap(entry.libraryId)}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-700/60 bg-cyan-950/40 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/50"
                          title="開啟編輯"
                        >
                          開啟
                        </button>
                        <button
                          type="button"
                          onClick={() => startRename(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title="重新命名"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(entry.libraryId)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title="複製地圖"
                        >
                          <Copy className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          title="導出地圖描述檔"
                        >
                          <Download className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300"
                          title="刪除"
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
        onConfirm={handleCreateBlank}
        onCancel={() => setNewMapDialogOpen(false)}
      />
    </div>
  )
}
