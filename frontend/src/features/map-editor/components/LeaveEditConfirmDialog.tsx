import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '../../../components/ui';

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
    <Dialog padded={false} title={t('mapEditor.leaveEditConfirm.title')} onClose={onCancel} widthClassName="w-full max-w-md">
<div className="px-6 pb-5 flex min-h-0 flex-1 flex-col overflow-auto">
        <p className="mt-3 text-body-s text-text-tertiary">
          {t('mapEditor.leaveEditConfirm.body')}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="danger" variant="outlined" onPress={onDiscard}>{t('mapEditor.leaveEditConfirm.discard')}</Button>
          <Button onPress={onSave}>{t('mapEditor.leaveEditConfirm.save')}</Button>
        </div>
      </div>
</Dialog>
  )
}
