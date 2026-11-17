import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import {
  clampMapPixelSize,
  MAX_MAP_PIXEL,
  MIN_MAP_PIXEL,
  type MapPixelSize,
} from '../constants/mapPixel'

type Props = {
  pixelSize: MapPixelSize
  minPixelSize: MapPixelSize
  readOnly: boolean
  onChange: (size: MapPixelSize) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
}

/** 未選 Area／設施時：監控畫布（解析度）屬性 */
export function MapCanvasInspectorSection({
  pixelSize,
  minPixelSize,
  readOnly,
  onChange,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const patch = (patch: Partial<MapPixelSize>) => {
    onChange(clampMapPixelSize({ ...pixelSize, ...patch }))
  }

  return (
    <aside data-inspector className="flex h-full min-h-0 flex-col bg-surface-primary">
      <div className="border-b border-border-quaternary px-3 py-2 text-body-xs-bold uppercase text-amber-500/90">
        {t('mapEditor.inspector.mapCanvas.title')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4 text-body-s">
        <p className="text-body-xs text-text-quaternary">
          {t('mapEditor.inspector.mapCanvas.hint')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-body-xs text-text-quaternary">
            {t('mapEditor.inspector.mapCanvas.width')}
            <NumberInput
              min={Math.max(MIN_MAP_PIXEL, minPixelSize.width)}
              max={MAX_MAP_PIXEL}
              step={1}
              disabled={readOnly}
              value={pixelSize.width}
              onChange={(n) => patch({ width: Math.round(n) })}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-status-warning disabled:opacity-50"
            />
          </label>
          <label className="block text-body-xs text-text-quaternary">
            {t('mapEditor.inspector.mapCanvas.height')}
            <NumberInput
              min={Math.max(MIN_MAP_PIXEL, minPixelSize.height)}
              max={MAX_MAP_PIXEL}
              step={1}
              disabled={readOnly}
              value={pixelSize.height}
              onChange={(n) => patch({ height: Math.round(n) })}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-status-warning disabled:opacity-50"
            />
          </label>
        </div>
        <p className="text-caption-2 text-text-disabled">
          {t('mapEditor.inspector.mapCanvas.limits', {
            minW: minPixelSize.width,
            minH: minPixelSize.height,
            absMin: MIN_MAP_PIXEL,
            absMax: MAX_MAP_PIXEL,
          })}
        </p>
      </div>
    </aside>
  )
}
