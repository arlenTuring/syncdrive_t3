import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * 統一說明小 i：hover／focus 用 fixed portal，避免被 overflow 容器裁切。
 */
export function HelpTip({
  label,
  children,
  side = 'bottom',
  widthClass = 'w-56',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  widthClass?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    const top = side === 'top' ? rect.top - 8 : rect.bottom + 8;
    setPos({ top, left });
  }, [side]);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => place();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <Info className="size-2.5" strokeWidth={2.5} />
      </button>
      {open && pos
        ? createPortal(
            <div
              id={tipId}
              role="tooltip"
              className={[
                'pointer-events-none fixed z-[300] -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-[11px] font-normal leading-relaxed text-zinc-300 shadow-xl',
                side === 'top' ? '-translate-y-full' : '',
                widthClass,
              ].join(' ')}
              style={{ top: pos.top, left: pos.left }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
