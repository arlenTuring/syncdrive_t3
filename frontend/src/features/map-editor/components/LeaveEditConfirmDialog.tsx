import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui';

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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black-50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-edit-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border-tertiary bg-surface-primary p-5 shadow-2xl">
        <h2
          id="leave-edit-title"
          className="text-headline-5 text-text-primary"
        >
          {t('mapEditor.leaveEditConfirm.title')}
        </h2>
        <p className="mt-3 text-body-s text-text-tertiary">
          {t('mapEditor.leaveEditConfirm.body')}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="subordinate" variant="outlined" onPress={onDiscard}>{t('mapEditor.leaveEditConfirm.discard')}</Button>
          <Button hierarchy="subordinate" variant="outlined" onPress={onSave}>{t('mapEditor.leaveEditConfirm.save')}</Button>
        </div>
      </div>
    </div>
  )
}
