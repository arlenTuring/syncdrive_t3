import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn, DIALOG_OVERLAY_CLASS, DIALOG_PANEL_CLASS, fieldClass as uiFieldClass, IconButton } from '../../components/ui';

export function Modal({ title, children, onClose, busy = false, maxWidth = 'max-w-xl' }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; maxWidth?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    return () => previous.current?.focus();
  }, []);
  return createPortal(
    <div className={cn(DIALOG_OVERLAY_CLASS, 'z-[100]')} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="access-modal-title" onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key !== 'Tab') return;
        const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }} className={cn(DIALOG_PANEL_CLASS, maxWidth)}>
        <header className="flex shrink-0 items-center px-7 py-6">
          <h2 id="access-modal-title" className="text-headline-4 text-text-primary">{title}</h2>
          <IconButton label="關閉" icon={<X />} size="small" hierarchy="subordinate" variant="standard" onClick={onClose} disabled={busy} className="ml-auto" />
        </header>
        {children}
      </div>
    </div>, document.body,
  );
}

/** 欄位樣式由 components/ui 提供；按鈕請直接用 components/ui 的 Button */
export const fieldClass = cn('mt-2', uiFieldClass());

export function passwordValid(value: string) { return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value); }
