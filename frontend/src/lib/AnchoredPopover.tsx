import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeAnchoredPosition, type AnchoredPosition } from './anchoredPosition';

/**
 * 跟著觸發按鈕的浮層（列操作選單、時間選擇面板…）。
 *
 * 掛到 document.body、position: fixed，所以不會被表格的 overflow-auto 或對話框裁切，也不用拿掉
 * 必要的捲動。規則：
 * - 以觸發元素定位；下方放不下就往上開；左右超出視窗就往內推。
 * - 捲動（任何層）或視窗 resize 時重新定位；觸發元素捲出可視範圍就關閉。
 * - 點外部、Escape 關閉；Escape 與選擇項目後焦點回到觸發元素。
 * - 層級：比觸發元素所在的那一層（例如所在的對話框）高一層，至少 40——仍低於頁面層級之上
 *   後開的 modal（z-50 起），不會穿過別的遮罩。不堆超大 z-index。
 */

const BASE_Z = 40;

/** 觸發元素所在那一層的 z-index（往上找最近有數字 z-index 的祖先） */
function layerZIndex(el: HTMLElement | null): number {
  let node: HTMLElement | null = el;
  let max = 0;
  while (node && node !== document.body) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(z)) max = Math.max(max, z);
    node = node.parentElement;
  }
  return max;
}

export function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  children,
  align = 'end',
  offset = 4,
  className,
  style,
  role,
  ariaLabel,
  autoFocus = true,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: (reason: 'outside' | 'escape' | 'scroll-away') => void;
  children: ReactNode;
  align?: 'start' | 'end';
  offset?: number;
  className?: string;
  style?: CSSProperties;
  /** 'menu'：上下鍵在 role=menuitem 之間移動 */
  role?: 'menu' | 'dialog';
  ariaLabel?: string;
  /** 打開時把焦點移到第一個可操作項目 */
  autoFocus?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<AnchoredPosition | null>(null);
  const [zIndex, setZIndex] = useState(BASE_Z);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    // 觸發元素被捲出可視範圍（表格捲動）：浮層不能掛在半空中
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
      onCloseRef.current('scroll-away');
      return;
    }
    const next = computeAnchoredPosition(
      rect,
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      align,
      offset,
    );
    setPos((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.placement === next.placement ? prev : next,
    );
  }, [anchorRef, align, offset]);

  useLayoutEffect(() => {
    if (!open) return;
    setZIndex(Math.max(BASE_Z, layerZIndex(anchorRef.current) + 1));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update, anchorRef]);

  // 第一次量到尺寸後才知道往上或往下；內容尺寸變了也重算
  useLayoutEffect(() => {
    if (!open || !panelRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => update());
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current('escape');
      anchorRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open || !autoFocus || !pos) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>(
      role === 'menu' ? '[role="menuitem"]:not([disabled])' : 'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [open, autoFocus, pos, role]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (role !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End')) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
          : e.key === 'ArrowDown' ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next].focus();
  };

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      data-anchored-popover={pos?.placement ?? 'measuring'}
      className={className}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // 量尺寸那一格先不顯示，避免閃一下在左上角
        visibility: pos ? 'visible' : 'hidden',
        zIndex,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
