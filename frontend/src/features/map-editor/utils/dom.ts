/** 焦點在可輸入元素時，避免攔截快捷鍵（複製貼上物件等） */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

/**
 * 是否應略過「刪除選取設施」快捷鍵。
 * Backspace 在任意 input 內留給欄位編輯；Delete 在文字類 input 內亦同。
 * range／color 等控件上仍可用 Delete 刪除設施（月台門屬性面板常見）。
 */
export function shouldBlockFacilityDeleteShortcut(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false

  const type = (el as HTMLInputElement).type
  if (e.key === 'Backspace') return true
  if (e.key === 'Delete') {
    return (
      type === 'text' ||
      type === 'number' ||
      type === 'search' ||
      type === 'password' ||
      type === 'email' ||
      type === 'url' ||
      type === '' ||
      type === 'tel'
    )
  }
  return false
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
