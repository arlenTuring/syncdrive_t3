import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, BookmarkPlus, Trash2, RotateCcw } from 'lucide-react'
import {
  clearMapRevisionsForLibrary,
  deleteMapRevision,
  formatRevisionByteSize,
  listMapRevisionMetas,
  MAX_REVISIONS_PER_MAP,
  recordMapRevision,
  revisionReasonLabel,
  type MapRevisionEditorState,
  type MapRevisionMeta,
} from '../utils/mapRevisionHistory'

type MapRevisionHistoryDialogProps = {
  open: boolean
  onClose: () => void
  libraryId: string
  /** 目前圖台狀態，供手動書籤 */
  getEditorState: () => MapRevisionEditorState
  onRestore: (revisionId: string) => Promise<void> | void
}

export function MapRevisionHistoryDialog({
  open,
  onClose,
  libraryId,
  getEditorState,
  onRestore,
}: MapRevisionHistoryDialogProps) {
  const [items, setItems] = useState<MapRevisionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bookmarking, setBookmarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!libraryId) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await listMapRevisionMetas(libraryId)
      setItems(rows)
    } catch {
      setError('無法讀取編修紀錄')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [libraryId])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  const handleBookmark = useCallback(async () => {
    setBookmarking(true)
    setError(null)
    try {
      const meta = await recordMapRevision(getEditorState(), {
        reason: 'manual-bookmark',
        force: true,
      })
      if (!meta) {
        setError('內容與最新紀錄相同，未新增書籤')
      }
      await refresh()
    } catch {
      setError('無法寫入書籤')
    } finally {
      setBookmarking(false)
    }
  }, [getEditorState, refresh])

  const handleRestore = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          '確定還原至此版本？目前圖台上未另外書籤的變更會被覆蓋。',
        )
      ) {
        return
      }
      setBusyId(id)
      setError(null)
      try {
        await onRestore(id)
        onClose()
      } catch {
        setError('還原失敗')
      } finally {
        setBusyId(null)
      }
    },
    [onRestore, onClose],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('刪除此筆編修紀錄？')) return
      setBusyId(id)
      try {
        await deleteMapRevision(id)
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [refresh],
  )

  const handleClearAll = useCallback(async () => {
    if (
      !window.confirm(
        `清除此地圖全部編修紀錄（最多 ${MAX_REVISIONS_PER_MAP} 筆）？此操作無法復原。`,
      )
    ) {
      return
    }
    setLoading(true)
    try {
      await clearMapRevisionsForLibrary(libraryId)
      await refresh()
    } finally {
      setLoading(false)
    }
  }, [libraryId, refresh])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-revision-history-title"
    >
      <div className="flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-zinc-600 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-700 px-5 py-4">
          <div>
            <h2
              id="map-revision-history-title"
              className="flex items-center gap-2 text-lg font-semibold text-zinc-100"
            >
              <History className="size-5 text-cyan-400" aria-hidden />
              編修紀錄
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              自動儲存會寫入地圖庫；此清單另以 IndexedDB
              保存可還原快照（節流＋上限 {MAX_REVISIONS_PER_MAP}{' '}
              筆，優先保留正式儲存／書籤）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            關閉
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={() => void handleBookmark()}
            disabled={bookmarking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/70 bg-cyan-950/50 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-900/60 disabled:opacity-50"
          >
            {bookmarking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <BookmarkPlus className="size-3.5" aria-hidden />
            )}
            標記目前狀態
          </button>
          <button
            type="button"
            onClick={() => void handleClearAll()}
            disabled={items.length === 0 || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            清除全部
          </button>
          <span className="ml-auto text-[11px] text-zinc-500">
            {items.length} / {MAX_REVISIONS_PER_MAP}
          </span>
        </div>

        {error && (
          <p className="shrink-0 px-5 pt-3 text-xs text-amber-300" role="alert">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              載入中…
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500">
              尚無編修紀錄。進入編輯或自動儲存後會開始累積。
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {revisionReasonLabel(item.reason)} ·{' '}
                        {formatRevisionByteSize(item.byteSize)} · Area{' '}
                        {item.summary.areaCount} · 設施{' '}
                        {item.summary.facilityCount} · 路線{' '}
                        {item.summary.routeCount} · 拓撲節點{' '}
                        {item.summary.topologyNodeCount}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleRestore(item.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-700/60 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-900/50 disabled:opacity-50"
                        title="還原至此版本"
                      >
                        {busyId === item.id ? (
                          <Loader2
                            className="size-3 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <RotateCcw className="size-3" aria-hidden />
                        )}
                        還原
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item.id)}
                        className="inline-flex items-center rounded-md border border-zinc-600 bg-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
                        title="刪除此筆"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
