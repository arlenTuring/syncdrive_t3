import React from 'react';
import type { ImageWidget } from '../types';
import { Image } from 'lucide-react';
import { useIsEditMode } from '../utils/widgetEditPreview';
import { resolveWidgetEditPreview } from '../utils/widgetEditPreview';


/** 疊加位置 → CSS 定位 */
function overlayPositionStyle(
  pos: ImageWidget['overlayPosition'],
): React.CSSProperties {
  switch (pos) {
    case 'top-left':      return { top: 0, left: 0, alignItems: 'flex-start', justifyContent: 'flex-start' };
    case 'top-center':    return { top: 0, left: 0, right: 0, alignItems: 'flex-start', justifyContent: 'center' };
    case 'top-right':     return { top: 0, right: 0, alignItems: 'flex-start', justifyContent: 'flex-end' };
    case 'bottom-left':   return { bottom: 0, left: 0, alignItems: 'flex-end', justifyContent: 'flex-start' };
    case 'bottom-center': return { bottom: 0, left: 0, right: 0, alignItems: 'flex-end', justifyContent: 'center' };
    case 'bottom-right':  return { bottom: 0, right: 0, alignItems: 'flex-end', justifyContent: 'flex-end' };
    case 'center':
    default:              return { top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' };
  }
}

export function ImageWidgetView({ widget }: { widget: ImageWidget }) {
  const isEditMode = useIsEditMode();

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: widget.borderRadius,
    border: widget.borderWidth
      ? `${widget.borderWidth}px solid ${widget.borderColor ?? 'rgba(255,255,255,0.15)'}`
      : undefined,
    background: widget.backgroundColor ?? 'transparent',
    opacity: widget.opacity != null ? widget.opacity / 100 : 1,
    boxSizing: 'border-box',
  };

  if (!widget.src) {
    const hint = isEditMode
      ? resolveWidgetEditPreview({ type: 'image' })
      : '請在屬性面板設定圖片 URL';
    return (
      <div style={{
        ...containerStyle,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: widget.backgroundColor ?? 'rgba(255,255,255,0.03)',
        border: widget.borderWidth
          ? `${widget.borderWidth}px solid ${widget.borderColor ?? 'rgba(168,85,247,0.35)'}`
          : '1px dashed rgba(168,85,247,0.35)',
        color: 'rgba(196,181,253,0.75)',
        fontSize: 11,
        fontStyle: isEditMode ? 'italic' : undefined,
      }}>
        <Image size={22} strokeWidth={1.5} />
        <span>{hint}</span>
      </div>
    );
  }

  const hasOverlay = !!widget.overlayText?.trim();
  const overlayPos = widget.overlayPosition ?? 'bottom-left';
  const posStyle = overlayPositionStyle(overlayPos);

  return (
    <div style={containerStyle}>
      <img
        src={widget.src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: widget.objectFit === 'none' ? undefined : widget.objectFit,
          borderRadius: widget.borderRadius,
        }}
        onError={e => { e.currentTarget.style.display = 'none'; }}
      />

      {/* 疊加文字 */}
      {hasOverlay && (
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            pointerEvents: 'none',
            padding: '4px 8px',
            ...posStyle,
          }}
        >
          <span
            style={{
              fontSize: widget.overlayFontSize ?? 13,
              color: widget.overlayTextColor ?? '#ffffff',
              fontWeight: widget.overlayFontWeight ?? 'normal',
              background: widget.overlayBgColor ?? 'rgba(0,0,0,0.45)',
              borderRadius: 4,
              padding: '2px 8px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {widget.overlayText}
          </span>
        </div>
      )}
    </div>
  );
}
