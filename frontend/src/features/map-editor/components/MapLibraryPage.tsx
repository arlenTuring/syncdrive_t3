import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CloudDownload,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Server,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { SetPrimaryMapDialog } from './SetPrimaryMapDialog'
import { BackToHomeButton } from '../../../components/BackToHomeButton'
import { StatusTag, type StatusTagStyle } from '../../../components/StatusTag'
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

type MapLibrarySortKey = 'name' | 'status' | 'version' | 'resolution' | 'createdAt' | 'updatedAt'

const PAGE_SIZE = 20

/** 不是主要地圖：灰色，不搶眼；要換主要地圖從該列的「…」選單 */
const NOT_IN_USE_TAG_STYLE: StatusTagStyle = {
  container: 'bg-zinc-800/80',
  dot: 'bg-zinc-500',
}

const IN_USE_TAG_STYLE: StatusTagStyle = {
  container: 'bg-[rgba(0,212,146,0.2)]',
  dot: 'bg-[#00D492]',
}

/** 清單上的時間：YYYY-MM-DD HH:mm（本地時間） */
function formatMapListDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function compareMapLibraryEntries(
  a: MapLibraryEntry,
  b: MapLibraryEntry,
  key: MapLibrarySortKey,
  activeMapId: string | null,
  activeLibraryId: string | null,
): number {
  switch (key) {
    case 'name':
      return a.displayName.localeCompare(b.displayName, 'zh-Hant')
    case 'status':
      return (
        Number(isMapLibraryEntryActive(b, activeMapId, activeLibraryId))
        - Number(isMapLibraryEntryActive(a, activeMapId, activeLibraryId))
      )
    case 'version':
      return a.version.localeCompare(b.version, undefined, { numeric: true })
    case 'resolution':
      return a.pixelSize.width * a.pixelSize.height - b.pixelSize.width * b.pixelSize.height
    case 'createdAt':
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    case 'updatedAt':
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  }
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
  const [primaryTarget, setPrimaryTarget] = useState<MapLibraryEntry | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<{ key: MapLibrarySortKey; dir: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const importMenuRef = useRef<HTMLDivElement>(null)

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

  /** 設為主要地圖：先檢查再切換（見 SetPrimaryMapDialog） */
  const handleSetActive = useCallback(
    (entry: MapLibraryEntry) => {
      if (isMapLibraryEntryActive(entry, activeMapId, activeLibraryId)) return
      setPrimaryTarget(entry)
    },
    [activeLibraryId, activeMapId],
  )

  const handlePrimaryActivated = useCallback(
    (mapId: string) => {
      if (!primaryTarget) return
      setActiveMapId(mapId)
      setActiveLibraryId(primaryTarget.libraryId)
      // 切換時已把最新內容存上後端
      persistEntries(
        readMapLibrary().map((e) =>
          e.libraryId === primaryTarget.libraryId ? { ...e, publishState: 'published' as const } : e,
        ),
      )
      setPrimaryTarget(null)
    },
    [persistEntries, primaryTarget],
  )

  const keywordActive = keyword.trim().length > 0
  const canSearch = keywordDraft.trim().length > 0
  const canReset = keywordDraft.length > 0 || keywordActive || sort != null

  const visibleEntries = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    const filtered = needle
      ? entries.filter((e) => e.displayName.toLowerCase().includes(needle))
      : entries
    if (!sort) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort(
      (a, b) =>
        dir * compareMapLibraryEntries(a, b, sort.key, activeMapId, activeLibraryId),
    )
  }, [entries, keyword, sort, activeMapId, activeLibraryId])

  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageEntries = visibleEntries.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )
  const pageNumbers = useMemo(() => {
    const max = Math.min(5, totalPages)
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - max + 1))
    return Array.from({ length: max }, (_, i) => start + i)
  }, [currentPage, totalPages])

  const applySearch = () => {
    setPage(1)
    setKeyword(keywordDraft.trim())
  }

  const resetFilters = () => {
    setKeywordDraft('')
    setKeyword('')
    setSort(null)
    setPage(1)
  }

  /** 同一欄：升冪 → 降冪 → 不排序 */
  const toggleSort = (key: MapLibrarySortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  useEffect(() => {
    if (!openMenuId && !importMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (openMenuId && rowMenuRef.current && !rowMenuRef.current.contains(target)) {
        setOpenMenuId(null)
      }
      if (importMenuOpen && importMenuRef.current && !importMenuRef.current.contains(target)) {
        setImportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [openMenuId, importMenuOpen])

  const columns: Array<{ key: MapLibrarySortKey; label: string; width: string }> = [
    { key: 'status', label: t('mapLibrary.columns.status'), width: 'w-[120px] min-w-[120px]' },
    { key: 'version', label: t('mapLibrary.columns.version'), width: 'w-[120px] min-w-[120px]' },
    { key: 'resolution', label: t('mapLibrary.columns.resolution'), width: 'min-w-[194px]' },
    { key: 'createdAt', label: t('mapLibrary.columns.createdAt'), width: 'min-w-[194px]' },
    { key: 'updatedAt', label: t('mapLibrary.columns.updatedAt'), width: 'min-w-[194px]' },
  ]

  const renderSortButton = (key: MapLibrarySortKey) => {
    const active = sort?.key === key
    const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg p-0.5 transition hover:bg-[rgba(209,213,220,0.08)] ${
          active ? 'text-[#51A2FF]' : 'text-[#99A1AF]'
        }`}
        title={t('mapLibrary.sortTitle')}
        aria-label={t('mapLibrary.sortTitle')}
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
    )
  }

  const menuItemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.08)]'
  const headCellClass =
    'h-12 border-b-[0.5px] border-[rgba(212,212,212,0.15)] px-3 py-0.5 text-left text-sm font-normal leading-[18px] tracking-[0.5px] text-[#99A1AF]'
  const bodyCellClass =
    'h-[52px] border-b-[0.5px] border-[rgba(212,212,212,0.15)] px-3 py-0.5 text-sm leading-[18px] tracking-[0.5px] text-[#F3F4F6]'
  /** 固定左欄／右欄：底色蓋住捲過去的內容，陰影標出固定邊 */
  const fixedLeftClass =
    'sticky left-0 z-10 w-[200px] min-w-[200px] bg-[#18181B] shadow-[12px_6px_16px_rgba(2,9,19,0.2)]'
  const fixedRightClass =
    'sticky right-0 z-10 w-[58px] min-w-[58px] bg-[#18181B] shadow-[-12px_6px_16px_rgba(2,9,19,0.2)]'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-[#18181B] p-3 text-[#F3F4F6]">
      {/* 篩選列 */}
      <div className="flex shrink-0 flex-wrap items-start gap-3 rounded-2xl p-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          {onBackToHome && <BackToHomeButton onClick={onBackToHome} />}
          <div className="flex h-[34px] w-[180px] items-center rounded-lg bg-[rgba(142,197,255,0.08)] px-3 py-1.5">
            <Search className="mr-1 size-5 shrink-0 text-[#99A1AF]" aria-hidden />
            <input
              type="search"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSearch) applySearch()
              }}
              placeholder={t('common.keywordPlaceholder')}
              className="min-w-0 flex-1 bg-transparent py-0.5 text-sm leading-[18px] tracking-[0.5px] text-[#F3F4F6] placeholder:text-[#99A1AF] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={applySearch}
            disabled={!canSearch}
            className={`inline-flex size-[34px] items-center justify-center rounded-lg p-0.5 transition ${
              canSearch
                ? 'bg-[rgba(43,127,255,0.2)] text-[#51A2FF] hover:bg-[rgba(43,127,255,0.3)]'
                : 'cursor-not-allowed bg-[rgba(98,116,142,0.2)] text-[#4A5565]'
            }`}
            title={t('common.search')}
            aria-label={t('common.search')}
          >
            <Search className="size-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!canReset}
            className={`inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[rgba(212,212,212,0.1)] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] transition ${
              canReset
                ? 'text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.08)]'
                : 'cursor-not-allowed text-[#4A5565]'
            }`}
            title={t('common.resetFiltersTitle')}
          >
            <RotateCw className="size-[18px]" aria-hidden />
            {t('mapLibrary.reset')}
          </button>
          {offline && (
            <span
              title={t('mapLibrary.offlineTitle')}
              className="rounded-lg border border-amber-800/70 px-2 py-1 text-xs text-amber-300"
            >
              {t('mapLibrary.offline')}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
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
          {/* 匯入：檔案、貼上、從伺服器載入收在同一顆按鈕 */}
          <div ref={importMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setImportMenuOpen((v) => !v)}
              aria-expanded={importMenuOpen}
              className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border border-[rgba(81,162,255,0.5)] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-[#51A2FF] transition hover:bg-[rgba(81,162,255,0.08)]"
            >
              <CloudDownload className="size-[18px]" aria-hidden />
              {t('mapLibrary.importFile')}
            </button>
            {importMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[rgba(212,212,212,0.15)] bg-[#18181B] py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setImportMenuOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className={menuItemClass}
                >
                  <FolderOpen className="size-4 text-[#99A1AF]" aria-hidden />
                  {t('mapLibrary.importFromFile')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportMenuOpen(false)
                    setPasteOpen((v) => !v)
                  }}
                  className={menuItemClass}
                >
                  <FileText className="size-4 text-[#99A1AF]" aria-hidden />
                  {t('mapLibrary.pasteFile')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportMenuOpen(false)
                    void handleOpenServerList()
                  }}
                  className={menuItemClass}
                >
                  <Server className="size-4 text-[#99A1AF]" aria-hidden />
                  {t('mapLibrary.loadFromServer')}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNewMapDialogOpen(true)}
            className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
          >
            <Plus className="size-[18px]" strokeWidth={2} aria-hidden />
            {t('mapLibrary.newBlank')}
          </button>
        </div>
      </div>

      {serverOpen && (
        <div className="shrink-0 rounded-2xl border border-[rgba(212,212,212,0.15)] p-3">
          <p className="text-xs text-[#99A1AF]">
            {t('mapLibrary.serverHintBefore')}
            <span className="text-[#D1D5DC]">{t('mapLibrary.serverHintEmphasis')}</span>
            {t('mapLibrary.serverHintAfter')}
          </p>

          {serverError ? (
            <p className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs text-red-300">
              {t('mapLibrary.serverListFailed', { error: serverError })}
            </p>
          ) : serverMaps === null ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#99A1AF]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('mapLibrary.serverLoading')}
            </p>
          ) : serverMaps.length === 0 ? (
            <p className="mt-2 text-xs text-[#99A1AF]">{t('mapLibrary.serverEmpty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-[rgba(212,212,212,0.15)]">
              {serverMaps.map((m) => (
                <li key={m.mapId} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm text-[#F3F4F6]">
                      {m.displayName}
                      {m.mapId === serverActiveId ? (
                        <StatusTag label={t('mapLibrary.inUse')} style={IN_USE_TAG_STYLE} />
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-[#99A1AF]">
                      {m.mapId} · {m.version ?? t('mapLibrary.noVersion')}
                      {m.updatedAt ? ` · ${formatMapListDate(m.updatedAt)}` : ''}
                      {typeof m.routeCount === 'number'
                        ? ` · ${t('mapLibrary.routeCount', { count: m.routeCount })}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={serverLoadingId != null}
                    onClick={() => void handleLoadFromServer(m)}
                    className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(81,162,255,0.5)] px-3.5 text-sm font-medium text-[#51A2FF] hover:bg-[rgba(81,162,255,0.08)] disabled:opacity-40"
                  >
                    {serverLoadingId === m.mapId ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <CloudDownload className="size-4" aria-hidden />
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
        <div className="shrink-0 rounded-2xl border border-[rgba(212,212,212,0.15)] p-3">
          <label htmlFor={pasteAreaId} className="text-xs text-[#99A1AF]">
            {t('mapLibrary.pasteLabel')}
          </label>
          <textarea
            id={pasteAreaId}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-lg bg-[rgba(142,197,255,0.08)] px-3 py-2 font-mono text-xs text-[#F3F4F6] outline-none focus:ring-1 focus:ring-[#51A2FF]"
            placeholder='{"schemaVersion":2,"mapId":"...", ...}'
          />
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setPasteOpen(false)
                setPasteText('')
              }}
              className="inline-flex h-[34px] items-center rounded-lg bg-[rgba(209,213,220,0.12)] px-3.5 text-sm font-medium text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.18)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handlePasteImport}
              className="inline-flex h-[34px] items-center rounded-lg bg-[#2B7FFF] px-3.5 text-sm font-medium text-white hover:bg-[#2569e6]"
            >
              {t('mapLibrary.import')}
            </button>
          </div>
        </div>
      )}

      {/* 表格 + 分頁 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* 內距放在捲動容器外：固定欄貼齊捲動邊界，左右不露出捲過去的內容 */}
        <div className="flex min-h-0 flex-1 flex-col px-3">
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[#99A1AF]">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                {t('mapLibrary.loading')}
              </div>
            ) : error ? (
              <p className="py-4 text-sm text-red-400">{error}</p>
            ) : (
              <table className="w-full min-w-[1040px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-20 bg-[#18181B]">
                  <tr>
                    <th className={`${headCellClass} ${fixedLeftClass} z-30`}>
                      <div className="flex items-center gap-1">
                        <span className="flex-1">{t('mapLibrary.columns.name')}</span>
                        {renderSortButton('name')}
                      </div>
                    </th>
                    {columns.map((col) => (
                      <th key={col.key} className={`${headCellClass} ${col.width}`}>
                        <div className="flex items-center gap-1">
                          <span className="flex-1 whitespace-nowrap">{col.label}</span>
                          {renderSortButton(col.key)}
                        </div>
                      </th>
                    ))}
                    <th
                      className={`${headCellClass} ${fixedRightClass} z-30`}
                      aria-label={t('mapLibrary.columns.actions')}
                    />
                  </tr>
                </thead>
                <tbody>
                  {pageEntries.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="py-16 text-center text-sm text-[#99A1AF]">
                        {entries.length === 0 ? t('mapLibrary.empty') : t('mapLibrary.noMatch')}
                      </td>
                    </tr>
                  ) : (
                    pageEntries.map((entry) => {
                      const isActive = isMapLibraryEntryActive(entry, activeMapId, activeLibraryId)
                        return (
                        <tr key={entry.libraryId} className="group">
                          <td className={`${bodyCellClass} ${fixedLeftClass} group-hover:bg-[#1f1f23]`}>
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
                                className="h-[34px] w-full rounded-lg bg-[rgba(142,197,255,0.08)] px-3 text-sm text-[#F3F4F6] outline-none focus:ring-1 focus:ring-[#51A2FF]"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenMap(entry.libraryId)}
                                className="block w-full truncate text-left hover:text-[#51A2FF]"
                                title={t('mapLibrary.openTitle')}
                              >
                                {entry.displayName}
                              </button>
                            )}
                          </td>
                          <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>
                            {isActive ? (
                              <StatusTag label={t('mapLibrary.inUse')} style={IN_USE_TAG_STYLE} />
                            ) : (
                              <StatusTag label={t('mapLibrary.notInUse')} style={NOT_IN_USE_TAG_STYLE} />
                            )}
                          </td>
                          <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>{entry.version}</td>
                          <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>
                            {entry.pixelSize.width} x {entry.pixelSize.height}
                          </td>
                          <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>
                            {formatMapListDate(entry.createdAt)}
                          </td>
                          <td className={`${bodyCellClass} group-hover:bg-[#1f1f23]`}>
                            {formatMapListDate(entry.updatedAt)}
                          </td>
                          {/* 選單開著的那一格要疊在後面幾列的固定欄之上，不然選單被下一列的「…」蓋住 */}
                          <td
                            className={`${bodyCellClass} ${fixedRightClass} group-hover:bg-[#1f1f23] ${
                              openMenuId === entry.libraryId ? '!z-[25]' : ''
                            }`}
                          >
                            <div
                              ref={openMenuId === entry.libraryId ? rowMenuRef : undefined}
                              className="relative flex justify-center"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenMenuId((prev) =>
                                    prev === entry.libraryId ? null : entry.libraryId,
                                  )
                                }
                                className="inline-flex size-[34px] items-center justify-center rounded-lg p-0.5 text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.08)]"
                                title={t('common.moreActions')}
                                aria-label={t('common.moreActions')}
                              >
                                <MoreHorizontal className="size-6" aria-hidden />
                              </button>
                              {openMenuId === entry.libraryId && (
                                <div className="absolute right-0 top-full z-40 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-[rgba(212,212,212,0.15)] bg-[#18181B] py-1 shadow-xl">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      onOpenMap(entry.libraryId)
                                    }}
                                    className={menuItemClass}
                                  >
                                    <FolderOpen className="size-4 text-[#99A1AF]" aria-hidden />
                                    {t('mapLibrary.openTitle')}
                                  </button>
                                  {!isActive && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null)
                                        handleSetActive(entry)
                                      }}
                                      className={menuItemClass}
                                      title={t('mapLibrary.setActiveTitle')}
                                    >
                                      <MapPin className="size-4 text-[#99A1AF]" aria-hidden />
                                      {t('mapLibrary.setActive')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      startRename(entry)
                                    }}
                                    className={menuItemClass}
                                  >
                                    <Pencil className="size-4 text-[#99A1AF]" aria-hidden />
                                    {t('mapLibrary.renameTitle')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      void handleDuplicate(entry.libraryId)
                                    }}
                                    className={menuItemClass}
                                  >
                                    <Copy className="size-4 text-[#99A1AF]" aria-hidden />
                                    {t('mapLibrary.duplicateTitle')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleExport(entry)
                                    }}
                                    className={menuItemClass}
                                  >
                                    <Download className="size-4 text-[#99A1AF]" aria-hidden />
                                    {t('mapLibrary.exportTitle')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      void handleDelete(entry)
                                    }}
                                    className={`${menuItemClass} hover:text-red-300`}
                                  >
                                    <Trash2 className="size-4 text-[#99A1AF]" aria-hidden />
                                    {t('common.delete')}
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {!loading && !error && visibleEntries.length > 0 && (
          <nav className="flex h-6 shrink-0 items-center justify-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              className="inline-flex size-6 items-center justify-center rounded-lg text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.08)] disabled:opacity-30"
              aria-label={t('mapLibrary.prevPage')}
            >
              <ChevronLeft className="size-[18px]" aria-hidden />
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                aria-current={n === currentPage ? 'page' : undefined}
                className={`inline-flex size-6 items-center justify-center rounded-lg text-sm leading-[18px] tracking-[0.5px] ${
                  n === currentPage
                    ? 'border border-[#51A2FF] text-[#51A2FF]'
                    : 'text-[#F3F4F6] hover:bg-[rgba(209,213,220,0.08)]'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              className="inline-flex size-6 items-center justify-center rounded-lg text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.08)] disabled:opacity-30"
              aria-label={t('mapLibrary.nextPage')}
            >
              <ChevronRight className="size-[18px]" aria-hidden />
            </button>
          </nav>
        )}
      </div>

      {primaryTarget && (
        <SetPrimaryMapDialog
          entry={primaryTarget}
          onClose={() => setPrimaryTarget(null)}
          onActivated={handlePrimaryActivated}
        />
      )}

      <NewMapPixelDialog
        open={newMapDialogOpen}
        onConfirm={handleCreateMap}
        onCancel={() => setNewMapDialogOpen(false)}
      />
    </div>
  )
}
