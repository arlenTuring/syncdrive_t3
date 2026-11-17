import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  clampMapPixelSize,
  DEFAULT_MAP_PIXEL_HEIGHT,
  DEFAULT_MAP_PIXEL_WIDTH,
  MAX_MAP_PIXEL,
  MIN_MAP_PIXEL,
  type MapPixelSize,
} from '../constants/mapPixel'
import type { MapCreationMode } from '../types/mapFile'
import { systemAlert } from '../../../lib/systemDialog'
import { Button, Dialog } from '../../../components/ui';

type Props = {
  open: boolean
  initialPixelSize?: MapPixelSize
  onConfirm: (pixelSize: MapPixelSize, creationMode: MapCreationMode) => void
  onCancel: () => void
}

export function NewMapPixelDialog({
  open,
  initialPixelSize,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const [creationMode, setCreationMode] = useState<MapCreationMode>('blank')
  const [widthStr, setWidthStr] = useState(
    String(initialPixelSize?.width ?? DEFAULT_MAP_PIXEL_WIDTH),
  )
  const [heightStr, setHeightStr] = useState(
    String(initialPixelSize?.height ?? DEFAULT_MAP_PIXEL_HEIGHT),
  )

  useEffect(() => {
    if (!open) return
    setCreationMode('blank')
    setWidthStr(String(initialPixelSize?.width ?? DEFAULT_MAP_PIXEL_WIDTH))
    setHeightStr(String(initialPixelSize?.height ?? DEFAULT_MAP_PIXEL_HEIGHT))
  }, [open, initialPixelSize?.width, initialPixelSize?.height])

  if (!open) return null

  const submit = () => {
    const width = Number.parseInt(widthStr, 10)
    const height = Number.parseInt(heightStr, 10)
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      void systemAlert(t('mapEditor.newMapPixel.invalidSize'))
      return
    }
    onConfirm(clampMapPixelSize({ width, height }), creationMode)
  }

  const modeCards: { mode: MapCreationMode; titleKey: string; hintKey: string }[] = [
    {
      mode: 'blank',
      titleKey: 'mapEditor.newMapPixel.modeBlank',
      hintKey: 'mapEditor.newMapPixel.modeBlankHint',
    },
    {
      mode: 'trackGen',
      titleKey: 'mapEditor.newMapPixel.modeTrackGen',
      hintKey: 'mapEditor.newMapPixel.modeTrackGenHint',
    },
  ]

  return (
    <Dialog padded={false} title={t('mapEditor.newMapPixel.title')} onClose={() => onCancel()} widthClassName="w-full max-w-lg">
<div className="px-6 pb-5 flex min-h-0 flex-1 flex-col overflow-auto">
        <p className="mt-2 text-body-s text-text-tertiary">
          {t('mapEditor.newMapPixel.hint')}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('mapEditor.newMapPixel.modeLabel')}>
          {modeCards.map(({ mode, titleKey, hintKey }) => {
            const selected = creationMode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCreationMode(mode)}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  selected
                    ? mode === 'trackGen'
                      ? 'border-status-success-light bg-status-success-light ring-1 ring-status-success-light'
                      : 'border-border-theme-light bg-surface-theme ring-1 ring-border-theme-light'
                    : 'border-border-quaternary bg-black-30 hover:border-border-primary'
                }`}
              >
                <div className={`text-body-s-bold ${selected ? (mode === 'trackGen' ? 'text-status-success' : 'text-text-theme-light') : 'text-text-primary'}`}>
                  {t(titleKey)}
                </div>
                <p className="mt-1 text-body-xs text-text-quaternary">
                  {t(hintKey)}
                </p>
              </button>
            )
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-body-xs text-text-quaternary">
            {t('mapEditor.newMapPixel.width')}
            <input
              type="number"
              min={MIN_MAP_PIXEL}
              max={MAX_MAP_PIXEL}
              step={1}
              value={widthStr}
              onChange={(e) => setWidthStr(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme"
            />
          </label>
          <label className="block text-body-xs text-text-quaternary">
            {t('mapEditor.newMapPixel.height')}
            <input
              type="number"
              min={MIN_MAP_PIXEL}
              max={MAX_MAP_PIXEL}
              step={1}
              value={heightStr}
              onChange={(e) => setHeightStr(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme"
            />
          </label>
        </div>
        <p className="mt-2 text-caption-2 text-text-disabled">
          {t('mapEditor.newMapPixel.range', {
            min: MIN_MAP_PIXEL,
            max: MAX_MAP_PIXEL,
            defaultW: DEFAULT_MAP_PIXEL_WIDTH,
            defaultH: DEFAULT_MAP_PIXEL_HEIGHT,
          })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button hierarchy="subordinate" variant="outlined" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button hierarchy="subordinate" variant="outlined" onPress={submit}>{creationMode === 'trackGen'
              ? t('mapEditor.newMapPixel.createTrackGen')
              : t('mapEditor.newMapPixel.create')}</Button>
        </div>
      </div>
</Dialog>
  )
}
