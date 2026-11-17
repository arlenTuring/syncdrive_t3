import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { settleSystemDialog, subscribeSystemDialogs, systemDialogSnapshot } from '../lib/systemDialog'

/**
 * 系統樣式的確認／提示對話框（顯示端）。呼叫端用 lib/systemDialog 的 systemConfirm／systemAlert。
 * Enter＝確定、Escape＝取消；開啟時焦點在主要按鈕上。
 */
export function SystemDialogHost() {
  const { t } = useTranslation()
  const items = useSyncExternalStore(subscribeSystemDialogs, systemDialogSnapshot)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const current = items[0] ?? null

  useEffect(() => {
    if (!current) return
    primaryRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settleSystemDialog(current.id, current.kind === 'alert')
      } else if (event.key === 'Enter') {
        event.preventDefault()
        settleSystemDialog(current.id, true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current])

  if (!current) return null

  const isConfirm = current.kind === 'confirm'
  const title = current.title ?? (isConfirm ? t('common.dialogTitleConfirm') : t('common.dialogTitleNotice'))
  const primaryClass = current.tone === 'danger'
    ? 'border-red-600 bg-red-950/80 text-red-100 hover:bg-red-900/80'
    : 'border-cyan-600 bg-cyan-950/80 text-cyan-100 hover:bg-cyan-900/80'

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settleSystemDialog(current.id, current.kind === 'alert')
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-5 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`system-dialog-title-${current.id}`}
        aria-describedby={`system-dialog-body-${current.id}`}
      >
        <h2 id={`system-dialog-title-${current.id}`} className="text-lg font-semibold text-zinc-100">
          {title}
        </h2>
        <p
          id={`system-dialog-body-${current.id}`}
          className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-line break-words text-sm leading-relaxed text-zinc-300"
        >
          {current.message}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {isConfirm ? (
            <button
              type="button"
              onClick={() => settleSystemDialog(current.id, false)}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
            >
              {current.cancelLabel ?? t('common.cancel')}
            </button>
          ) : null}
          <button
            ref={primaryRef}
            type="button"
            onClick={() => settleSystemDialog(current.id, true)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${primaryClass}`}
          >
            {current.confirmLabel ?? (isConfirm ? t('common.confirm') : t('common.ok'))}
          </button>
        </div>
      </div>
    </div>
  )
}
