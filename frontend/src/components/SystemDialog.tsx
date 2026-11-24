import { useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { settleSystemDialog, subscribeSystemDialogs, systemDialogSnapshot } from '../lib/systemDialog'
import { Dialog, DialogEventActions, type DialogTone } from './ui'

/**
 * 系統樣式的確認／提示對話框（顯示端）。呼叫端用 lib/systemDialog 的 systemConfirm／systemAlert。
 * 外框、按鈕都用 components/ui；Enter＝確定、Escape＝取消；開啟時焦點在主要按鈕上。
 */
export function SystemDialogHost() {
  const { t } = useTranslation()
  const items = useSyncExternalStore(subscribeSystemDialogs, systemDialogSnapshot)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const current = items[0] ?? null
  if (!current) return null

  const isConfirm = current.kind === 'confirm'
  const title = current.title ?? (isConfirm ? t('common.dialogTitleConfirm') : t('common.dialogTitleNotice'))
  // 取消（或提示框的關閉）：確認框回 false，提示框視為看過
  const dismiss = () => settleSystemDialog(current.id, current.kind === 'alert')

  const tone: DialogTone = current.tone === 'danger' ? 'error' : current.tone === 'default' ? 'info' : current.tone

  return (
    <Dialog
      key={current.id}
      role="alertdialog"
      layer="system"
      tone={tone}
      title={title}
      onClose={dismiss}
      hideClose
      initialFocusRef={primaryRef}
      footer={
        <DialogEventActions
          tone={tone}
          cancelLabel={current.cancelLabel ?? t('common.cancel')}
          confirmLabel={current.confirmLabel ?? (isConfirm ? t('common.confirm') : t('common.ok'))}
          onCancel={isConfirm ? () => settleSystemDialog(current.id, false) : undefined}
          onConfirm={() => settleSystemDialog(current.id, true)}
          confirmRef={primaryRef}
        />
      }
    >
      <p className="whitespace-pre-line break-words">{current.message}</p>
    </Dialog>
  )
}
