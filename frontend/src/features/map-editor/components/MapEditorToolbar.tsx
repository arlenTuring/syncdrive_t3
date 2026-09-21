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
  ScanSearch,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
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
  /** Edit mode: Area meter rulers — off / scale (domain) / field (real coords) */
  rulerDisplayMode?: 'off' | 'scale' | 'field'
  onCycleRulerDisplayMode?: () => void
  rulersToggleHint?: string
  /** @deprecated use rulerDisplayMode */
  showRulers?: boolean
  onToggleRulers?: () => void
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
  /** 軌道檢查：有問題的軌道數（null＝還沒算完）與面板開關 */
  trackIssueCount?: number | null
  trackIssuesOpen?: boolean
  onToggleTrackIssues?: () => void
  /** 在每塊軌道上畫現場行進方向 */
}

/** 一組相關的工具：同一個外框，內部靠留白分開 */
function ToolGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-700/80 bg-zinc-900/70 p-0.5"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  )
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-zinc-700/70" aria-hidden />
}

type ToolButtonProps = {
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  title?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  /** active 時的色調；預設 cyan */
  tone?: 'cyan' | 'amber' | 'emerald'
  testId?: string
  badge?: ReactNode
  /** 單獨放（不在群組裡）時要有自己的外框 */
  standalone?: boolean
}

const ACTIVE_TONE = {
  cyan: 'bg-cyan-950/70 text-cyan-200',
  amber: 'bg-amber-950/70 text-amber-200',
  emerald: 'bg-emerald-950/70 text-emerald-200',
} as const

/**
 * 工具列上的按鈕：高度一致（32px）、圖示在前。
 * 寬度不夠時只留圖示（名稱在 tooltip），2xl 以上才顯示文字，避免一排擠到互相蓋住。
 */
function ToolButton({
  Icon,
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  tone = 'cyan',
  testId,
  badge,
  standalone = false,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active || undefined}
      aria-label={label}
      title={title ?? label}
      data-testid={testId}
      className={[
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-40 2xl:px-2.5',
        standalone ? 'border border-zinc-700/80 bg-zinc-900/70' : '',
        active ? ACTIVE_TONE[tone] : 'text-zinc-300 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-100',
      ].join(' ')}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden 2xl:inline">{label}</span>
      {badge}
    </button>
  )
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
  rulerDisplayMode = 'off',
  onCycleRulerDisplayMode,
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
  trackIssueCount = null,
  trackIssuesOpen = false,
  onToggleTrackIssues,
}: MapEditorToolbarProps) {
  const { t } = useTranslation()
  const isEdit = mapEditorMode === 'edit'
  const rulerActive = rulerDisplayMode !== 'off' || showRulers
  const rulerLabel =
    rulerDisplayMode === 'field'
      ? t('mapEditor.toolbar.rulersField')
      : rulerDisplayMode === 'scale'
        ? t('mapEditor.toolbar.rulersScale')
        : t('mapEditor.toolbar.rulers')
  const rulerTitle =
    rulersToggleHint ??
    (rulerDisplayMode === 'field'
      ? t('mapEditor.toolbar.rulersTitleField')
      : rulerDisplayMode === 'scale'
        ? t('mapEditor.toolbar.rulersTitleScale')
        : t('mapEditor.toolbar.rulersTitle'))
  const hasViewTools =
    (isEdit && (onCycleRulerDisplayMode || onToggleRulers)) ||
    (isEdit && onToggleMapCanvasResize) ||
    (isEdit && onToggleAreaCenterLabels) ||
    (isEdit && onToggleFacilityToolbars) ||
    onToggleZoomLevelBar

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-zinc-700/80 bg-zinc-950 px-4 py-2"
      role="toolbar"
      aria-label={t('mapEditor.toolbar.aria')}
    >
      {/* 左：離開、地圖身分、復原重做 */}
      <ToolButton
        Icon={ArrowLeft}
        label={t('mapEditor.toolbar.list')}
        title={t('mapEditor.toolbar.backToList')}
        onClick={onBackToLibrary}
        standalone
      />

      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
          isEdit
            ? 'bg-cyan-950/80 text-cyan-300 ring-cyan-700/60'
            : 'bg-zinc-800 text-zinc-400 ring-zinc-600'
        }`}
      >
        {isEdit ? t('mapEditor.toolbar.edit') : t('mapEditor.toolbar.view')}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label className="sr-only" htmlFor="map-editor-display-name">
          {t('mapEditor.toolbar.mapName')}
        </label>
        <input
          id="map-editor-display-name"
          value={mapDisplayName}
          onChange={(e) => onMapDisplayNameChange(e.target.value)}
          className="h-8 min-w-[6rem] max-w-[16rem] flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-500"
          title={t('mapEditor.toolbar.mapName')}
        />
        <label className="sr-only" htmlFor="map-editor-version">
          {t('mapEditor.toolbar.version')}
        </label>
        <input
          id="map-editor-version"
          value={mapVersion}
          onChange={(e) => onMapVersionChange(e.target.value)}
          className="h-8 w-20 shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500"
          title={t('mapEditor.toolbar.version')}
        />

        {(isEdit || onOpenRevisionHistory) && (
          <ToolGroup label={t('mapEditor.toolbar.undoRedoAria')}>
            {isEdit && (
              <>
                <ToolButton
                  Icon={Undo2}
                  label={t('mapEditor.toolbar.undo')}
                  title={t('mapEditor.toolbar.undoTitle')}
                  onClick={onUndo}
                  disabled={!canUndo}
                />
                <ToolButton
                  Icon={Redo2}
                  label={t('mapEditor.toolbar.redo')}
                  title={t('mapEditor.toolbar.redoTitle')}
                  onClick={onRedo}
                  disabled={!canRedo}
                />
              </>
            )}
            {isEdit && onOpenRevisionHistory ? <Divider /> : null}
            {onOpenRevisionHistory && (
              <ToolButton
                Icon={History}
                label={t('mapEditor.toolbar.revisionHistory')}
                title={t('mapEditor.toolbar.revisionHistoryTitle')}
                onClick={onOpenRevisionHistory}
              />
            )}
          </ToolGroup>
        )}
      </div>

      {/* 右：畫面輔助 → 檢查與測試 → 編輯／離開 → 置中 */}
      {hasViewTools && (
        <ToolGroup label={t('mapEditor.toolbar.cropGroupAria')}>
          {isEdit && (onCycleRulerDisplayMode || onToggleRulers) && (
            <ToolButton
              Icon={Ruler}
              label={rulerLabel}
              title={rulerTitle}
              onClick={onCycleRulerDisplayMode ?? onToggleRulers}
              active={rulerActive}
              tone={rulerDisplayMode === 'field' ? 'emerald' : 'cyan'}
            />
          )}
          {isEdit && onToggleAreaCenterLabels && (
            <ToolButton
              Icon={Highlighter}
              label={t('mapEditor.toolbar.areaLabels')}
              title={areaCenterLabelsToggleHint ?? t('mapEditor.toolbar.areaLabelsTitle')}
              onClick={onToggleAreaCenterLabels}
              active={showAreaCenterLabels}
            />
          )}
          {isEdit && onToggleFacilityToolbars && (
            <ToolButton
              Icon={Component}
              label={t('mapEditor.toolbar.facilityBars')}
              title={facilityToolbarsToggleHint ?? t('mapEditor.toolbar.facilityBarsTitle')}
              onClick={onToggleFacilityToolbars}
              active={showFacilityToolbars}
            />
          )}
          {onToggleZoomLevelBar && (
            <ToolButton
              Icon={ZoomIn}
              label={
                showZoomLevelBar ? t('mapEditor.toolbar.hideZoom') : t('mapEditor.toolbar.zoomBar')
              }
              title={zoomLevelBarToggleHint ?? t('mapEditor.toolbar.zoomBarTitle')}
              onClick={onToggleZoomLevelBar}
              active={showZoomLevelBar}
            />
          )}
          {isEdit && onToggleMapCanvasResize && (
            <>
              <ToolButton
                Icon={Frame}
                label={t('mapEditor.toolbar.crop')}
                title={mapCanvasResizeToggleHint ?? t('mapEditor.toolbar.cropTitle')}
                onClick={onToggleMapCanvasResize}
                active={mapCanvasResizeActive}
                tone="amber"
              />
              {mapCanvasResizeActive && onApplyMapCrop ? (
                <button
                  type="button"
                  onClick={onApplyMapCrop}
                  className="inline-flex h-8 shrink-0 items-center rounded-md border border-amber-600/70 bg-amber-950/70 px-2.5 text-xs font-medium text-amber-100 transition hover:bg-amber-900/60"
                  title={t('mapEditor.toolbar.applyCropTitle')}
                >
                  {t('mapEditor.toolbar.applyCrop')}
                </button>
              ) : null}
              {mapCanvasResizeActive && onCancelMapCrop ? (
                <button
                  type="button"
                  onClick={onCancelMapCrop}
                  className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                  title={t('mapEditor.toolbar.cancelCropTitle')}
                >
                  {t('mapEditor.toolbar.cancel')}
                </button>
              ) : null}
            </>
          )}
        </ToolGroup>
      )}

      {(onToggleTrackIssues || onToggleTestDock) && (
        <ToolGroup>
          {onToggleTrackIssues && (
            <ToolButton
              Icon={ScanSearch}
              label={t('mapEditor.toolbar.trackCheck')}
              title={t('mapEditor.toolbar.trackCheckTitle')}
              onClick={onToggleTrackIssues}
              active={trackIssuesOpen || !!trackIssueCount}
              tone={trackIssueCount ? 'amber' : 'emerald'}
              testId="track-check-button"
              badge={
                trackIssueCount === null ? null : trackIssueCount > 0 ? (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-zinc-950">
                    {trackIssueCount}
                  </span>
                ) : (
                  <span className="text-emerald-400" aria-label={t('mapEditor.toolbar.trackCheckOk')}>
                    ✓
                  </span>
                )
              }
            />
          )}
          {onToggleTestDock && (
            <ToolButton
              Icon={FlaskConical}
              label={showTestDock ? t('mapEditor.toolbar.hideTester') : t('mapEditor.toolbar.tester')}
              title={testDockToggleHint ?? t('mapEditor.toolbar.testerTitle')}
              onClick={onToggleTestDock}
              active={showTestDock}
            />
          )}
        </ToolGroup>
      )}

      {isEdit ? (
        <ToolButton
          Icon={LogOut}
          label={t('mapEditor.toolbar.leaveEdit')}
          title={t('mapEditor.toolbar.leaveEditTitle')}
          onClick={onLeaveEdit}
          standalone
        />
      ) : (
        <button
          type="button"
          onClick={onEnterEdit}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-3 text-xs font-medium text-cyan-200 transition hover:bg-cyan-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          title={t('mapEditor.toolbar.enterEditTitle')}
        >
          <Pencil className="size-4 shrink-0" aria-hidden />
          <span>{t('mapEditor.toolbar.enterEdit')}</span>
        </button>
      )}
      <ToolButton
        Icon={Crosshair}
        label={t('mapEditor.toolbar.center')}
        title={t('mapEditor.toolbar.centerTitle')}
        onClick={onCenterMap}
        standalone
      />
    </div>
  )
}
