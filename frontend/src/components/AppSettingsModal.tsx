import { useState } from 'react'
import { RotateCcw, Settings, Trash2, X } from 'lucide-react'
import {
  clearAllCanvasExampleAndDraftCache,
  restoreAllCanvasExamples,
} from '../lib/canvasCacheReset'

type Props = {
  onClose: () => void
}

export function AppSettingsModal({ onClose }: Props) {
  const [busy, setBusy] = useState<'idle' | 'clear' | 'restore'>('idle')

  async function handleRestoreExamples() {
    const ok = window.confirm(
      '確定要還原兩個圖台的內建範例？\n\n' +
        '• 地圖編輯器：重載標準範例「軌道合併加道路線」，不會刪除您自建或複製的地圖\n' +
        '• 儀表板：還原 3840×1080 內建範例大屏（事件／班次／運能）\n\n' +
        '內建範例的本機修改將被取代，頁面將自動重新整理。',
    )
    if (!ok) return

    setBusy('restore')
    try {
      const { dashboardRestored } = await restoreAllCanvasExamples()
      if (!dashboardRestored) {
        alert('儀表板範例寫入失敗，請稍後再試。')
        setBusy('idle')
        return
      }
      window.location.reload()
    } catch {
      alert('還原失敗，請稍後再試。')
      setBusy('idle')
    }
  }

  async function handleClearCanvasCache() {
    const ok = window.confirm(
      '確定要清除兩個圖台的暫存？\n\n' +
        '• 地圖編輯器：刪除編輯草稿（保留地圖庫中的地圖）\n' +
        '• 儀表板：刪除已儲存的平面配置\n\n' +
        '清除後重新整理仍會載入預設範例；若要強制套用最新內建版請使用「還原範例」。\n\n' +
        '此操作無法還原，頁面將自動重新整理。',
    )
    if (!ok) return

    setBusy('clear')
    try {
      const { removedMapKeys, hadDashboardCache } =
        clearAllCanvasExampleAndDraftCache()
      if (removedMapKeys === 0 && !hadDashboardCache) {
        alert('沒有找到可清除的圖台暫存。')
        setBusy('idle')
        return
      }
      window.location.reload()
    } catch {
      alert('清除失敗，請稍後再試。')
      setBusy('idle')
    }
  }

  const disabled = busy !== 'idle'

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-labelledby="app-settings-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2.5 text-zinc-100">
            <Settings className="size-5 text-cyan-400" aria-hidden />
            <h2 id="app-settings-title" className="text-base font-semibold">
              應用程式設定
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <p className="text-xs leading-relaxed text-zinc-500">
            此設定適用於整個 SyncDrive T3（首頁、儀表板、地圖編輯器）。資料來源連線設定不受影響。
          </p>

          <section className="rounded-xl border border-zinc-700/60 bg-zinc-800/20 p-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              圖台範例與暫存
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              地圖編輯器與儀表板圖台共用本機快取機制；可一次還原內建範例，或僅清除暫存。
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-zinc-400">
              <li>
                地圖編輯器：編輯中的 <code className="text-cyan-400/90">草稿</code>{' '}
                （地圖庫內容不受影響）
              </li>
              <li>儀表板：已儲存的大屏平面與版面種子</li>
            </ul>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => void handleRestoreExamples()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-600/45 bg-cyan-600/15 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-600/30 disabled:opacity-50"
              >
                <RotateCcw className="size-4 shrink-0" aria-hidden />
                {busy === 'restore' ? '還原中…' : '還原兩個圖台範例'}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void handleClearCanvasCache()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-600/45 bg-amber-600/15 px-4 py-2.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-600/30 disabled:opacity-50"
              >
                <Trash2 className="size-4 shrink-0" aria-hidden />
                {busy === 'clear' ? '清除中…' : '清除兩個圖台暫存'}
              </button>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
