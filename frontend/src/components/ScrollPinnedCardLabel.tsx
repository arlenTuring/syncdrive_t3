import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 卡面文字<strong>捲到哪跟到哪</strong>：卡片左緣被捲出畫面時，文字往右平移貼齊
 * 可視左緣，一路跟到卡片右緣為止，卡片捲完才跟著離開。
 *
 * 不能用 <code>position: sticky</code>——卡片本身有 <code>overflow-hidden</code>，
 * 那會建立一個不會捲動的 scrollport，sticky 就黏在卡片自己身上，等於沒有作用。
 * transform 不受任何祖先的 overflow 影響。
 *
 * 效能：直接改 DOM style、rAF 節流，不觸發 React re-render；位置用
 * 「捲動位置 ＋ 已知的卡片座標」算，只有文字寬度需要量，而那個由 ResizeObserver
 * 快取，捲動時一次版面讀取都不做。三份拷貝下同時掛著上百張卡，這個差別有感。
 */
export function ScrollPinnedCardLabel({
  cardLeftPx,
  cardWidthPx,
  insetPx = 0,
  rowLabelWidth,
  className,
  children,
}: {
  /** 卡片左緣在捲動內容座標系裡的位置（含左側列號欄與第幾份日拷貝） */
  cardLeftPx: number;
  cardWidthPx: number;
  /** 卡面文字原本的起點（開頭被別的東西壓住時會往右讓） */
  insetPx?: number;
  /** 左側常駐列號欄的寬度——它會蓋住卡片，可視左緣要從它右邊算起 */
  rowLabelWidth: number;
  className?: string;
  children: ReactNode;
}) {
  const labelRef = useRef<HTMLDivElement>(null);
  const labelWidthRef = useRef(0);

  useEffect(() => {
    const label = labelRef.current;
    if (!label) return;
    const grid = label.closest('[data-schedule-grid-scroll]');
    if (!(grid instanceof HTMLElement)) return;

    const EDGE_PAD = 4;
    let raf = 0;
    let lastShift = Number.NaN;
    const apply = () => {
      raf = 0;
      const visibleLeft = grid.scrollLeft + rowLabelWidth + EDGE_PAD;
      const target = Math.max(insetPx, visibleLeft - cardLeftPx);
      // 不能推過卡片右緣——卡片捲完了字就該跟著走
      const maxLeft = Math.max(insetPx, cardWidthPx - labelWidthRef.current - EDGE_PAD);
      const shift = Math.min(target, maxLeft) - insetPx;
      if (Number.isFinite(lastShift) && Math.abs(shift - lastShift) < 0.5) return;
      lastShift = shift;
      label.style.transform = shift <= 0.5 ? 'none' : `translate3d(${shift}px, 0, 0)`;
    };
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(apply);
    };

    // 文字寬度只在內容或字體變動時改變，量一次存起來；捲動時不再讀版面
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        labelWidthRef.current = entry.contentRect.width;
      }
      schedule();
    });
    observer.observe(label);
    labelWidthRef.current = label.offsetWidth;
    apply();

    grid.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      grid.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [cardLeftPx, cardWidthPx, insetPx, rowLabelWidth]);

  return (
    <div
      ref={labelRef}
      className={className}
      style={insetPx > 0 ? { paddingLeft: insetPx } : undefined}
    >
      {children}
    </div>
  );
}
