/**
 * 系統樣式的確認／提示對話框：呼叫端 API 與佇列
 * ==========================================
 *
 * 取代瀏覽器原生的 window.confirm／window.alert。原生視窗長在瀏覽器外框上（標題寫「localhost:5173 顯示」），
 * 樣式、字型、深色主題都跟系統對不上，按鈕也不能翻譯（2026-11-17 使用者指出）。
 *
 * 用法：
 *   if (!(await systemConfirm('確定要…？'))) return
 *   void systemAlert('儲存失敗：…')
 *
 * 畫面由 components/SystemDialog.tsx 的 <SystemDialogHost />（main.tsx 已掛）顯示；同時有好幾個請求就依序一個一個顯示。
 */

/** default＝一般提示（Info 圖示）；danger＝刪除、清除這類無法復原的動作（Error 圖示、紅色主要按鈕）；success、warning 照 Dialog 規範的同名類型 */
export type SystemDialogTone = 'default' | 'danger' | 'success' | 'warning'

export type SystemDialogRequest = {
  id: number
  kind: 'confirm' | 'alert'
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  tone: SystemDialogTone
  resolve: (value: boolean) => void
}

export type SystemDialogOptions = {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** danger：刪除、清除這類無法復原的動作，主要按鈕用紅色 */
  tone?: SystemDialogTone
}

let nextId = 1
let queue: readonly SystemDialogRequest[] = []
const listeners = new Set<() => void>()

function publish() {
  for (const listener of listeners) listener()
}

function enqueue(request: Omit<SystemDialogRequest, 'id' | 'resolve'>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 畫面上沒有掛 host（例如單元測試）：提示直接當作看過，確認一律當作取消，不讓呼叫端永遠等下去
    if (listeners.size === 0) {
      resolve(request.kind === 'alert')
      return
    }
    queue = [...queue, { ...request, id: nextId++, resolve }]
    publish()
  })
}

/** 確認：使用者按確定回 true，取消／Escape／點背景回 false */
export function systemConfirm(message: string, options: SystemDialogOptions = {}): Promise<boolean> {
  return enqueue({ kind: 'confirm', message, ...options, tone: options.tone ?? 'default' })
}

/** 提示：使用者按「知道了」之後 resolve */
export async function systemAlert(message: string, options: Omit<SystemDialogOptions, 'cancelLabel'> = {}): Promise<void> {
  await enqueue({ kind: 'alert', message, ...options, tone: options.tone ?? 'default' })
}

/** 回覆目前這一個請求 */
export function settleSystemDialog(id: number, value: boolean) {
  const item = queue.find((entry) => entry.id === id)
  if (!item) return
  queue = queue.filter((entry) => entry.id !== id)
  publish()
  item.resolve(value)
}

export function subscribeSystemDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function systemDialogSnapshot(): readonly SystemDialogRequest[] {
  return queue
}
