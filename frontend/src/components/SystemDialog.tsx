import { useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { settleSystemDialog, subscribeSystemDialogs, systemDialogSnapshot } from '../lib/systemDialog'
import { Button, Dialog } from './ui'

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

  return (
    <Dialog
      key={current.id}
      role="alertdialog"
      layer="system"
      size="md"
      title={title}
      onClose={dismiss}
      hideClose
      initialFocusRef={primaryRef}
      footer={
        <>
          {isConfirm ? (
            <Button hierarchy="subordinate" variant="tonal" onClick={() => settleSystemDialog(current.id, false)}>
              {current.cancelLabel ?? t('common.cancel')}
            </Button>
          ) : null}
          <Button
            ref={primaryRef}
            hierarchy={current.tone === 'danger' ? 'danger' : 'superior'}
            variant="filled"
            onClick={() => settleSystemDialog(current.id, true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                settleSystemDialog(current.id, true)
              }
            }}
          >
            {current.confirmLabel ?? (isConfirm ? t('common.confirm') : t('common.ok'))}
          </Button>
        </>
      }
    >
      <p className="max-h-[50vh] whitespace-pre-line break-words">{current.message}</p>
    </Dialog>
  )
}
