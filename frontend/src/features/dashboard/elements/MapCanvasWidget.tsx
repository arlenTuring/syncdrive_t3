/**
 * @deprecated 請改用畫布「圖台容器」。保留此子元件以相容舊版儀表板 JSON。
 */
import type { MapCanvasWidget } from '../types';
import { MapPlatformLayer } from './MapPlatformLayer';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import { useIsEditMode, resolveWidgetPreviewLabel } from '../utils/widgetEditPreview';

export function MapCanvasWidgetView({ widget }: { widget: MapCanvasWidget }) {
  const isEditMode = useIsEditMode();
  const label = resolveWidgetPreviewLabel({
    title: widget.mapId || '圖台',
    type: 'map-canvas',
  });
  return (
    <WidgetEditPreviewOutline active={isEditMode} label={label}>
      <MapPlatformLayer mapId={widget.mapId} zoomFactor={widget.zoomFactor} />
    </WidgetEditPreviewOutline>
  );
}
