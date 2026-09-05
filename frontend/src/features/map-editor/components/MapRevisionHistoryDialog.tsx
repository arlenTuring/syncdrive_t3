import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, BookmarkPlus, Trash2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  clearMapRevisionsForLibrary,
  deleteMapRevision,
  formatRevisionByteSize,
  listMapRevisionMetas,
  MAX_REVISIONS_PER_MAP,
  recordMapRevision,
  type MapRevisionEditorState,
  type MapRevisionMeta,
  type MapRevisionReason,
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
  const { t } = useTranslation()
  const [items, setItems] = useState<MapRevisionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bookmarking, setBookmarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonLabel = useCallback(
    (reason: MapRevisionReason) => t(`mapEditor.revision.reasons.${reason}`),
    [t],
  )

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
      setError(t('mapEditor.revision.loadFailed'))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [libraryId, t])

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
        setError(t('mapEditor.revision.bookmarkDuplicate'))
      }
      await refresh()
    } catch {
      setError(t('mapEditor.revision.bookmarkFailed'))
    } finally {
      setBookmarking(false)
    }
  }, [getEditorState, refresh, t])

  const handleRestore = useCallback(
    async (id: string) => {
      if (!window.confirm(t('mapEditor.revision.restoreConfirm'))) {
        return
      }
      setBusyId(id)
      setError(null)
      try {
        await onRestore(id)
        onClose()
      } catch {
        setError(t('mapEditor.revision.restoreFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [onRestore, onClose, t],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t('mapEditor.revision.deleteConfirm'))) return
      setBusyId(id)
      try {
        await deleteMapRevision(id)
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [refresh, t],
  )

  const handleClearAll = useCallback(async () => {
    if (
      !window.confirm(
        t('mapEditor.revision.clearConfirm', { max: MAX_REVISIONS_PER_MAP }),
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
  }, [libraryId, refresh, t])

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
              {t('mapEditor.revision.title')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {t('mapEditor.revision.hint', { max: MAX_REVISIONS_PER_MAP })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            {t('common.close')}
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
            {t('mapEditor.revision.bookmark')}
          </button>
          <button
            type="button"
            onClick={() => void handleClearAll()}
            disabled={items.length === 0 || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            {t('mapEditor.revision.clearAll')}
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
              {t('common.loading')}
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500">
              {t('mapEditor.revision.empty')}
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
                        {reasonLabel(item.reason)} ·{' '}
                        {formatRevisionByteSize(item.byteSize)} ·{' '}
                        {t('mapEditor.revision.summary', {
                          areas: item.summary.areaCount,
                          facilities: item.summary.facilityCount,
                          routes: item.summary.routeCount,
                          nodes: item.summary.topologyNodeCount,
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleRestore(item.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-700/60 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-900/50 disabled:opacity-50"
                        title={t('mapEditor.revision.restoreTitle')}
                      >
                        {busyId === item.id ? (
                          <Loader2
                            className="size-3 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <RotateCcw className="size-3" aria-hidden />
                        )}
                        {t('mapEditor.revision.restore')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item.id)}
                        className="inline-flex items-center rounded-md border border-zinc-600 bg-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
                        title={t('mapEditor.revision.deleteTitle')}
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
