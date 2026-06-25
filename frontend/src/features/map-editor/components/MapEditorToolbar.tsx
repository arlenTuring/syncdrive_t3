import {
  ArrowLeft,
  Crosshair,
  Frame,
  Highlighter,
  LogOut,
  Pencil,
  Redo2,
  Ruler,
  Undo2,
  ZoomIn,
  Component,
} from 'lucide-react'
type MapEditorToolbarProps = {
  mapEditorMode: 'view' | 'edit'
  onEnterEdit: () => void
  onLeaveEdit: () => void
  onBackToLibrary: () => void
  mapDisplayName: string
  mapVersion: string
  onMapDisplayNameChange: (value: string) => void
  onMapVersionChange: (value: string) => void
  onCenterMap: () => void
  /** 僅編輯模式顯示：復原／重做 */
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** 編輯模式：Area 公尺刻度顯示 */
  showRulers?: boolean
  onToggleRulers?: () => void
  rulersToggleHint?: string
  /** 編輯模式：Area 中央總覽標示（名稱 / 場域範圍 / 像素尺寸） */
  showAreaCenterLabels?: boolean
  onToggleAreaCenterLabels?: () => void
  areaCenterLabelsToggleHint?: string
  /** 底部圖台縮放列（1 近～7 遠） */
  showZoomLevelBar?: boolean
  onToggleZoomLevelBar?: () => void
  zoomLevelBarToggleHint?: string
  /** 編輯模式：裁減模式 */
  mapCanvasResizeActive?: boolean
  onToggleMapCanvasResize?: () => void
  mapCanvasResizeToggleHint?: string
  onApplyMapCrop?: () => void
  onCancelMapCrop?: () => void
  /** 編輯模式：選取元件時顯示圓形工具列（旋轉、格式複製、刪除等） */
  showFacilityToolbars?: boolean
  onToggleFacilityToolbars?: () => void
  facilityToolbarsToggleHint?: string
}

/** 地圖編輯器工具列 */
export function MapEditorToolbar({
  mapEditorMode,
  onEnterEdit,
  onLeaveEdit,
  onBackToLibrary,
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
  showZoomLevelBar = true,
  onToggleZoomLevelBar,
  zoomLevelBarToggleHint,
  mapCanvasResizeActive = false,
  onToggleMapCanvasResize,
  mapCanvasResizeToggleHint,
  onApplyMapCrop,
  onCancelMapCrop,
  showFacilityToolbars = true,
  onToggleFacilityToolbars,
  facilityToolbarsToggleHint,
}: MapEditorToolbarProps) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-700/80 bg-zinc-950 px-4 py-2 sm:flex-nowrap"
      role="toolbar"
      aria-label="地圖編輯"
    >
      <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onBackToLibrary}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 sm:text-sm"
          title="返回地圖清單"
        >
          <ArrowLeft className="size-3.5 shrink-0 sm:size-4" aria-hidden />
          <span className="hidden sm:inline">清單</span>
        </button>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:text-xs ${
            mapEditorMode === 'view'
              ? 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600'
              : 'bg-cyan-950/80 text-cyan-300 ring-1 ring-cyan-700/60'
          }`}
        >
          {mapEditorMode === 'view' ? '檢視' : '編輯'}
        </span>

        <div className="flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="map-editor-display-name">
            地圖名稱
          </label>
          <input
            id="map-editor-display-name"
            value={mapDisplayName}
            onChange={(e) => onMapDisplayNameChange(e.target.value)}
            className="max-w-[min(100%,14rem)] shrink rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-100 outline-none focus:border-cyan-500 sm:max-w-[18rem] sm:text-sm"
            title="地圖名稱"
          />
          <label className="sr-only" htmlFor="map-editor-version">
            版本號
          </label>
          <input
            id="map-editor-version"
            value={mapVersion}
            onChange={(e) => onMapVersionChange(e.target.value)}
            className="w-[5.5rem] shrink-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500 sm:w-24 sm:text-sm"
            title="版本號"
          />
        </div>

        {mapEditorMode === 'edit' && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-600 bg-zinc-900/90 p-0.5 shadow-sm"
            role="toolbar"
            aria-label="復原與重做"
          >
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-100 transition enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5 sm:text-xs"
              title="復原 (⌘/Ctrl+Z)"
            >
              <Undo2 className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">復原</span>
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-100 transition enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5 sm:text-xs"
              title="重做 (⌘/Ctrl+Shift+Z 或 Ctrl+Y)"
            >
              <Redo2 className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">重做</span>
            </button>
          </div>
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
            title={rulersToggleHint ?? '顯示／隱藏 Area 公尺刻度'}
          >
            <Ruler className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">刻度</span>
          </button>
        )}
        {mapEditorMode === 'edit' && onToggleMapCanvasResize && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-600 bg-zinc-900/90 p-0.5 shadow-sm"
            role="group"
            aria-label="裁減畫布"
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
              title={
                mapCanvasResizeToggleHint ??
                '進入／結束裁減模式（拖曳琥珀色外框）'
              }
            >
              <Frame className="size-3.5 shrink-0 sm:size-4" aria-hidden />
              <span className="hidden sm:inline">裁減</span>
            </button>
            {mapCanvasResizeActive && onApplyMapCrop ? (
              <button
                type="button"
                onClick={onApplyMapCrop}
                className="inline-flex shrink-0 items-center rounded-md border border-amber-600/70 bg-amber-950/70 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-900/60 focus:outline-none focus:ring-2 focus:ring-amber-500/60 sm:text-xs"
                title="套用裁切並寫入地圖"
              >
                套用裁切
              </button>
            ) : null}
            {mapCanvasResizeActive && onCancelMapCrop ? (
              <button
                type="button"
                onClick={onCancelMapCrop}
                className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 sm:px-2.5 sm:text-xs"
                title="取消裁減（不變更畫布）"
              >
                取消
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
              areaCenterLabelsToggleHint ??
              '顯示／隱藏所有 Area 中央總覽標示（名稱 / 場域範圍 / 像素尺寸）'
            }
          >
            <Highlighter className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">區域標示</span>
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
              facilityToolbarsToggleHint ??
              '顯示／隱藏所有選取元件的圓形工具列（旋轉、格式複製、刪除等）'
            }
          >
            <Component className="size-3.5 shrink-0 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">元件列</span>
          </button>
        )}
      </div>

      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
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
            title={zoomLevelBarToggleHint ?? '顯示／隱藏底部圖台縮放列'}
          >
            <ZoomIn className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">縮放列</span>
          </button>
        )}

        {mapEditorMode === 'view' ? (
          <button
            type="button"
            onClick={onEnterEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-2 py-1.5 text-xs font-medium text-cyan-200 shadow-sm transition hover:bg-cyan-900/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
            title="進入編輯模式後可拖曳、新增設施與修改屬性"
          >
            <Pencil className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">編輯</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLeaveEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-100 shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
            title="離開編輯模式（若有變更將詢問是否儲存）"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">離開編輯</span>
          </button>
        )}

        <button
          type="button"
          onClick={onCenterMap}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-100 shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:px-3 sm:text-sm"
          title="捲至目前地圖檔的 mapCenterMeters（無則對準設施群；無設施則對準原點 0,0）"
        >
          <Crosshair className="size-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">置中</span>
        </button>
      </div>
    </div>
  )
}
