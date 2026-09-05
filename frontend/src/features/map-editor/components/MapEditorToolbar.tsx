import {
  ArrowLeft,
  Crosshair,
  Frame,
  Highlighter,
  History,
  LogOut,
  Pencil,
  Redo2,
  Ruler,
  Undo2,
  ZoomIn,
  Component,
  FlaskConical,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

type MapEditorToolbarProps = {
  mapEditorMode: 'view' | 'edit'
  onEnterEdit: () => void
  onLeaveEdit: () => void
  onBackToLibrary: () => void
  onOpenRevisionHistory?: () => void
  mapDisplayName: string
  mapVersion: string
  onMapDisplayNameChange: (value: string) => void
  onMapVersionChange: (value: string) => void
  onCenterMap: () => void
  /** Edit mode only: undo / redo */
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** Edit mode: Area meter rulers */
  showRulers?: boolean
  onToggleRulers?: () => void
  rulersToggleHint?: string
  /** Edit mode: Area center overview labels */
  showAreaCenterLabels?: boolean
  onToggleAreaCenterLabels?: () => void
  areaCenterLabelsToggleHint?: string
  /** Bottom zoom bar (1 near – 7 far) */
  showZoomLevelBar?: boolean
  onToggleZoomLevelBar?: () => void
  zoomLevelBarToggleHint?: string
  /** Bottom tester (gap scan + MQTT sim) */
  showTestDock?: boolean
  onToggleTestDock?: () => void
  testDockToggleHint?: string
  /** Edit mode: crop mode */
  mapCanvasResizeActive?: boolean
  onToggleMapCanvasResize?: () => void
  mapCanvasResizeToggleHint?: string
  onApplyMapCrop?: () => void
  onCancelMapCrop?: () => void
  /** Edit mode: circular toolbars on selection */
  showFacilityToolbars?: boolean
  onToggleFacilityToolbars?: () => void
  facilityToolbarsToggleHint?: string
}

/** Map editor toolbar */
export function MapEditorToolbar({
  mapEditorMode,
  onEnterEdit,
  onLeaveEdit,
  onBackToLibrary,
  onOpenRevisionHistory,
  mapDisplayName,
  mapVersion,
  onMapDisplayNameChange,
  onMapVersionChange,
  onCenterMap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showRulers = false,
  onToggleRulers,
  rulersToggleHint,
  showAreaCenterLabels = false,
  onToggleAreaCenterLabels,
  areaCenterLabelsToggleHint,
  showZoomLevelBar = false,
  onToggleZoomLevelBar,
  zoomLevelBarToggleHint,
  showTestDock = false,
  onToggleTestDock,
  testDockToggleHint,
  mapCanvasResizeActive = false,
  onToggleMapCanvasResize,
  mapCanvasResizeToggleHint,
  onApplyMapCrop,
  onCancelMapCrop,
  showFacilityToolbars = true,
  onToggleFacilityToolbars,
  facilityToolbarsToggleHint,
}: MapEditorToolbarProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-700/80 bg-zinc-950 px-4 py-2 sm:flex-nowrap"
      role="toolbar"
      aria-label={t('mapEditor.toolbar.aria')}
    >
      <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onBackToLibrary}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 sm:text-sm"
          title={t('mapEditor.toolbar.backToList')}
        >
          <ArrowLeft className="size-3.5 shrink-0 sm:size-4" aria-hidden />
          <span className="hidden sm:inline">{t('mapEditor.toolbar.list')}</span>
        </button>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:text-xs ${
            mapEditorMode === 'view'
              ? 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600'
              : 'bg-cyan-950/80 text-cyan-300 ring-1 ring-cyan-700/60'
          }`}
        >
          {mapEditorMode === 'view'
            ? t('mapEditor.toolbar.view')
            : t('mapEditor.toolbar.edit')}
        </span>

        <div className="flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="map-editor-display-name">
            {t('mapEditor.toolbar.mapName')}
          </label>
          <input
            id="map-editor-display-name"
            value={mapDisplayName}
            onChange={(e) => onMapDisplayNameChange(e.target.value)}
            className="max-w-[min(100%,14rem)] shrink rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-100 outline-none focus:border-cyan-500 sm:max-w-[18rem] sm:text-sm"
            title={t('mapEditor.toolbar.mapName')}
          />
          <label className="sr-only" htmlFor="map-editor-version">
            {t('mapEditor.toolbar.version')}
          </label>
          <input
            id="map-editor-version"
            value={mapVersion}
            onChange={(e) => onMapVersionChange(e.target.value)}
            className="w-[5.5rem] shrink-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500 sm:w-24 sm:text-sm"
            title={t('mapEditor.toolbar.version')}
          />
        </div>

        {mapEditorMode === 'edit' && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-600 bg-zinc-900/90 p-0.5 shadow-sm"
            role="toolbar"
            aria-label={t('mapEditor.toolbar.undoRedoAria')}
          >
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-100 transition enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5 sm:text-xs"
              title={t('mapEditor.toolbar.undoTitle')}
            >
              <Undo2 className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">{t('mapEditor.toolbar.undo')}</span>
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-100 transition enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5 sm:text-xs"
              title={t('mapEditor.toolbar.redoTitle')}
            >
              <Redo2 className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">{t('mapEditor.toolbar.redo')}</span>
            </button>
          </div>
        )}

        {onOpenRevisionHistory && (
          <button
            type="button"
            onClick={onOpenRevisionHistory}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-2.5 sm:text-xs"
            title={t('mapEditor.toolbar.revisionHistoryTitle')}
          >
            <History className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.revisionHistory')}</span>
          </button>
        )}

        {mapEditorMode === 'edit' && onToggleRulers && (
          <button
            type="button"
            onClick={onToggleRulers}
            aria-pressed={showRulers}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-2.5 sm:text-xs ${
              showRulers
                ? 'border-cyan-600/70 bg-cyan-950/60 text-cyan-200'
                : 'border-zinc-600 bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
            }`}
            title={rulersToggleHint ?? t('mapEditor.toolbar.rulersTitle')}
          >
            <Ruler className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.rulers')}</span>
          </button>
        )}
        {mapEditorMode === 'edit' && onToggleMapCanvasResize && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-600 bg-zinc-900/90 p-0.5 shadow-sm"
            role="group"
            aria-label={t('mapEditor.toolbar.cropGroupAria')}
          >
            <button
              type="button"
              onClick={onToggleMapCanvasResize}
              aria-pressed={mapCanvasResizeActive}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-500/60 sm:px-2.5 sm:text-xs ${
                mapCanvasResizeActive
                  ? 'bg-amber-950/60 text-amber-200'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
              title={mapCanvasResizeToggleHint ?? t('mapEditor.toolbar.cropTitle')}
            >
              <Frame className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">{t('mapEditor.toolbar.crop')}</span>
            </button>
            {mapCanvasResizeActive && onApplyMapCrop ? (
              <button
                type="button"
                onClick={onApplyMapCrop}
                className="inline-flex shrink-0 items-center rounded-md border border-amber-600/70 bg-amber-950/70 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-900/60 focus:outline-none focus:ring-2 focus:ring-amber-500/60 sm:text-xs"
                title={t('mapEditor.toolbar.applyCropTitle')}
              >
                {t('mapEditor.toolbar.applyCrop')}
              </button>
            ) : null}
            {mapCanvasResizeActive && onCancelMapCrop ? (
              <button
                type="button"
                onClick={onCancelMapCrop}
                className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 sm:px-2.5 sm:text-xs"
                title={t('mapEditor.toolbar.cancelCropTitle')}
              >
                {t('mapEditor.toolbar.cancel')}
              </button>
            ) : null}
          </div>
        )}
        {mapEditorMode === 'edit' && onToggleAreaCenterLabels && (
          <button
            type="button"
            onClick={onToggleAreaCenterLabels}
            aria-pressed={showAreaCenterLabels}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-500/60 sm:px-2.5 sm:text-xs ${
              showAreaCenterLabels
                ? 'border-amber-600/70 bg-amber-950/60 text-amber-200'
                : 'border-zinc-600 bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
            }`}
            title={
              areaCenterLabelsToggleHint ?? t('mapEditor.toolbar.areaLabelsTitle')
            }
          >
            <Highlighter className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.areaLabels')}</span>
          </button>
        )}
        {mapEditorMode === 'edit' && onToggleFacilityToolbars && (
          <button
            type="button"
            onClick={onToggleFacilityToolbars}
            aria-pressed={showFacilityToolbars}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-2.5 sm:text-xs ${
              showFacilityToolbars
                ? 'border-cyan-600/70 bg-cyan-950/60 text-cyan-200'
                : 'border-zinc-600 bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800'
            }`}
            title={
              facilityToolbarsToggleHint ?? t('mapEditor.toolbar.facilityBarsTitle')
            }
          >
            <Component className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.facilityBars')}</span>
          </button>
        )}
      </div>

      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
        {onToggleTestDock && (
          <button
            type="button"
            onClick={onToggleTestDock}
            aria-pressed={showTestDock}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm ${
              showTestDock
                ? 'border-violet-600/70 bg-violet-950/60 text-violet-200'
                : 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
            }`}
            title={testDockToggleHint ?? t('mapEditor.toolbar.testerTitle')}
          >
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">
              {showTestDock
                ? t('mapEditor.toolbar.hideTester')
                : t('mapEditor.toolbar.tester')}
            </span>
          </button>
        )}

        {onToggleZoomLevelBar && (
          <button
            type="button"
            onClick={onToggleZoomLevelBar}
            aria-pressed={showZoomLevelBar}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm ${
              showZoomLevelBar
                ? 'border-cyan-600/70 bg-cyan-950/60 text-cyan-200'
                : 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
            }`}
            title={zoomLevelBarToggleHint ?? t('mapEditor.toolbar.zoomBarTitle')}
          >
            <ZoomIn className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">
              {showZoomLevelBar
                ? t('mapEditor.toolbar.hideZoom')
                : t('mapEditor.toolbar.zoomBar')}
            </span>
          </button>
        )}

        {mapEditorMode === 'view' ? (
          <button
            type="button"
            onClick={onEnterEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-2 py-1.5 text-xs font-medium text-cyan-200 shadow-sm transition hover:bg-cyan-900/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
            title={t('mapEditor.toolbar.enterEditTitle')}
          >
            <Pencil className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.enterEdit')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLeaveEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-100 shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
            title={t('mapEditor.toolbar.leaveEditTitle')}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{t('mapEditor.toolbar.leaveEdit')}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onCenterMap}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-100 shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
          title={t('mapEditor.toolbar.centerTitle')}
        >
          <Crosshair className="size-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">{t('mapEditor.toolbar.center')}</span>
        </button>
      </div>
    </div>
  )
}
