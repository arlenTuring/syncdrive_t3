import type { ImageWidget } from '../types';
import { Image } from 'lucide-react';
import { useIsEditMode } from '../utils/widgetEditPreview';
import { resolveWidgetEditPreview } from '../utils/widgetEditPreview';

export function ImageWidgetView({ widget }: { widget: ImageWidget }) {
  const isEditMode = useIsEditMode();
  if (!widget.src) {
    const hint = isEditMode
      ? resolveWidgetEditPreview({ type: 'image' })
      : '請在屬性面板設定圖片 URL';
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(168,85,247,0.35)',
                    borderRadius: widget.borderRadius, color: 'rgba(196,181,253,0.75)', fontSize: 11,
                    fontStyle: isEditMode ? 'italic' : undefined }}>
        <Image size={22} strokeWidth={1.5} />
        <span>{hint}</span>
      </div>
    );
  }
  return (
    <img
      src={widget.src}
      alt=""
      style={{
        width: '100%', height: '100%', display: 'block',
        objectFit: widget.objectFit,
        borderRadius: widget.borderRadius,
      }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}
