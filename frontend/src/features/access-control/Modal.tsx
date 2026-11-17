import type { ReactNode } from 'react';
import { cn, Dialog, fieldClass as uiFieldClass } from '../../components/ui';

/**
 * 帳號權限模組的對話框：直接用系統的 Dialog（內容與底部列由各對話框自己排版）。
 * 保留這個名稱與參數，讓既有對話框不用改呼叫方式；新程式請直接用 components/ui 的 Dialog。
 */
export function Modal({ title, children, onClose, busy = false, maxWidth = 'max-w-xl' }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; maxWidth?: string }) {
  return (
    <Dialog title={title} onClose={onClose} busy={busy} padded={false} widthClassName={maxWidth}>
      {children}
    </Dialog>
  );
}

/** 欄位樣式由 components/ui 提供；按鈕請直接用 components/ui 的 Button */
export const fieldClass = cn('mt-2', uiFieldClass());

export function passwordValid(value: string) { return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value); }
