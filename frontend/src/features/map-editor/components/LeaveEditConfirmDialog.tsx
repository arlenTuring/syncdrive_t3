import { useTranslation } from 'react-i18next'

type LeaveEditConfirmDialogProps = {
  open: boolean
  onCancel: () => void
  onSave: () => void
  onDiscard: () => void
}

export function LeaveEditConfirmDialog({
  open,
  onCancel,
  onSave,
  onDiscard,
}: LeaveEditConfirmDialogProps) {
  const { t } = useTranslation()
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-edit-title"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-5 shadow-2xl">
        <h2
          id="leave-edit-title"
          className="text-lg font-semibold text-zinc-100"
        >
          {t('mapEditor.leaveEditConfirm.title')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          {t('mapEditor.leaveEditConfirm.body')}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
          >
            {t('mapEditor.leaveEditConfirm.discard')}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg border border-cyan-600 bg-cyan-950/80 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-900/80"
          >
            {t('mapEditor.leaveEditConfirm.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
