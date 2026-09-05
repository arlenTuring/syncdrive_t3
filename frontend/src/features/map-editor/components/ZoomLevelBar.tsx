import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ZOOM_LEVEL_COUNT } from '../utils/zoom'

type ZoomLevelBarProps = {
  level: number
  onLevelChange: (level: number) => void
  disabled?: boolean
  /** 底部元件庫橫列展開時上移 */
  paletteOpen?: boolean
  /** 底部測試控制面板存在時上移，避免重疊 */
  testDockOffset?: boolean
  onDismiss?: () => void
}

export function ZoomLevelBar({
  level,
  onLevelChange,
  disabled = false,
  paletteOpen = false,
  testDockOffset = false,
  onDismiss,
}: ZoomLevelBarProps) {
  const { t } = useTranslation()
  const clamp = (n: number) =>
    Math.max(1, Math.min(ZOOM_LEVEL_COUNT, n))
  const displayLevel = Math.round(level)

  const bottomClass = paletteOpen
    ? testDockOffset
      ? 'bottom-36 sm:bottom-40'
      : 'bottom-28 sm:bottom-28'
    : testDockOffset
      ? 'bottom-36 sm:bottom-40'
      : 'bottom-6'

  return (
    <div
      className={`pointer-events-auto absolute left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-600/50 bg-zinc-900/70 px-3 py-2 shadow-lg backdrop-blur-sm ${bottomClass}`}
      role="group"
      aria-label={t('mapEditor.zoomLevelBar.aria')}
    >
      <button
        type="button"
        disabled={disabled || displayLevel <= 1}
        onClick={() => onLevelChange(clamp(displayLevel - 1))}
        className="rounded-full p-1.5 text-zinc-300 transition enabled:hover:bg-zinc-800 enabled:hover:text-cyan-300 disabled:opacity-30"
        title={t('mapEditor.zoomLevelBar.zoomInTitle')}
        aria-label={t('mapEditor.zoomLevelBar.zoomInAria')}
      >
        <ZoomIn className="size-5" aria-hidden />
      </button>

      <div className="flex min-w-[10rem] flex-col items-center gap-0.5">
        <label htmlFor="map-zoom-slider" className="sr-only">
          {t('mapEditor.zoomLevelBar.levelLabel', { count: ZOOM_LEVEL_COUNT })}
        </label>
        <input
          id="map-zoom-slider"
          type="range"
          min={1}
          max={ZOOM_LEVEL_COUNT}
          step={1}
          value={displayLevel}
          disabled={disabled}
          onChange={(e) => onLevelChange(Number(e.target.value))}
          className="h-2 w-40 cursor-pointer accent-cyan-500 disabled:opacity-40 sm:w-48"
        />
        <div className="flex w-full justify-between text-[10px] text-zinc-500">
          <span title={t('mapEditor.zoomLevelBar.nearTitle')}>
            {t('mapEditor.zoomLevelBar.near')}
          </span>
          <span className="font-mono text-cyan-400/90">{displayLevel}</span>
          <span title={t('mapEditor.zoomLevelBar.farTitle')}>
            {t('mapEditor.zoomLevelBar.far', { count: ZOOM_LEVEL_COUNT })}
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled || displayLevel >= ZOOM_LEVEL_COUNT}
        onClick={() => onLevelChange(clamp(displayLevel + 1))}
        className="rounded-full p-1.5 text-zinc-300 transition enabled:hover:bg-zinc-800 enabled:hover:text-cyan-300 disabled:opacity-30"
        title={t('mapEditor.zoomLevelBar.zoomOutTitle')}
        aria-label={t('mapEditor.zoomLevelBar.zoomOutAria')}
      >
        <ZoomOut className="size-5" aria-hidden />
      </button>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="ml-0.5 rounded-full p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          title={t('mapEditor.zoomLevelBar.hideTitle')}
          aria-label={t('mapEditor.zoomLevelBar.hideAria')}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
