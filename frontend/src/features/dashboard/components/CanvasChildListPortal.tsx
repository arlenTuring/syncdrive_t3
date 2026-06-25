import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChildWidget } from '../types';
import {
  getWidgetDisplayName,
  getWidgetTypeLabel,
} from '../utils/widgetDisplayMeta';

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  canvasLabel: string;
  childWidgets: ChildWidget[];
  selectedChildIds: string[];
  onSelectCanvas: () => void;
  onSelectChild: (childId: string) => void;
};

/** 浮層清單：不受平面 overflow 裁切，固定於標籤列上方 */
export function CanvasChildListPortal({
  open,
  anchorRef,
  canvasLabel,
  childWidgets,
  selectedChildIds,
  onSelectCanvas,
  onSelectChild,
}: Props) {
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.top - 4 });
    };
    update();
    const ro = new ResizeObserver(update);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ left: r.left, top: r.top - 4 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-canvas-child-list
      data-canvas-child-list-root
      role="listbox"
      aria-label={`${canvasLabel} 子元件清單`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: 'translateY(-100%)',
        zIndex: 50000,
        minWidth: 160,
        maxWidth: 240,
        maxHeight: Math.min(280, Math.max(120, pos.top - 12)),
        overflowY: 'auto',
        borderRadius: 4,
        border: '1px solid rgba(6,182,212,0.55)',
        background: 'rgba(15,22,35,0.98)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.65)',
        pointerEvents: 'auto',
      }}
    >
      {childWidgets.length === 0 ? (
        <div
          style={{
            padding: '8px 10px',
            fontSize: 10,
            color: 'rgba(148,163,184,0.9)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          此畫布尚無子元件
        </div>
      ) : (
        childWidgets.map((child) => {
          const itemSelected = selectedChildIds.includes(child.id);
          return (
            <button
              key={child.id}
              type="button"
              role="option"
              aria-selected={itemSelected}
              title={getWidgetTypeLabel(child.type)}
              onClick={(e) => {
                e.stopPropagation();
                onSelectCanvas();
                onSelectChild(child.id);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                padding: '6px 10px',
                cursor: 'pointer',
                background: itemSelected
                  ? 'rgba(6,182,212,0.28)'
                  : 'transparent',
                color: itemSelected ? '#e0f2fe' : '#e2e8f0',
                outline: itemSelected
                  ? '1px solid rgba(34,211,238,0.45)'
                  : 'none',
                outlineOffset: -1,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: 'system-ui, sans-serif',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getWidgetDisplayName(child)}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 9,
                  color: itemSelected ? '#67e8f9' : 'rgba(148,163,184,0.85)',
                  fontFamily: 'monospace',
                }}
              >
                {getWidgetTypeLabel(child.type)}
              </div>
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );
}
