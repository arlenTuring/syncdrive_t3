import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, children, onClose, busy = false, maxWidth = 'max-w-xl' }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; maxWidth?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    return () => previous.current?.focus();
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="access-modal-title" onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key !== 'Tab') return;
        const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }} className={`flex max-h-[calc(100vh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-[#17181c] shadow-2xl`}>
        <header className="flex shrink-0 items-center px-7 py-6">
          <h2 id="access-modal-title" className="text-xl font-semibold text-zinc-100">{title}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="關閉"><X className="size-6" /></button>
        </header>
        {children}
      </div>
    </div>, document.body,
  );
}

export const fieldClass = 'mt-2 w-full rounded-xl border border-transparent bg-[#232933] px-4 py-3 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-500';
export const primaryClass = 'rounded-xl bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500';
export const dangerClass = 'rounded-xl bg-red-600 px-5 py-2.5 font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-700';

export function passwordValid(value: string) { return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value); }
