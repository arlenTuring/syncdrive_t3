import {
  ArrowLeft,
  Component,
  Crosshair,
  Eye,
  Frame,
  Highlighter,
  History,
  Loader2,
  MapPin,
  Pencil,
  Redo2,
  Ruler,
  ScanSearch,
  Undo2,
} from 'lucide-react'
import type { ComponentType } from 'react'
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
  /** 座標資訊框：選取物件的座標（沒選取時顯示提示）與畫布尺寸 */
  coordsText: string
  canvasText: string
  /** 資訊框的 tooltip（地圖模式等補充） */
  infoTitle?: string
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
  /** 編輯模式：自動儲存狀態；送後端失敗時可重試 */
  autosaving?: boolean
  autosaveLabel?: string
  syncFailed?: boolean
  retryingSync?: boolean
  onRetrySync?: () => void
  /** 這張是主要地圖：修改存下就是系統在讀的內容 */
  isPrimaryMap?: boolean
  /** 不是主要地圖時：設為主要地圖（會先檢查部署中的班表，見 SetPrimaryMapDialog） */
  onSetPrimaryMap?: () => void
}

/**
 * 設計稿的按鈕：高 34、圓角 8、左右 14、字 14/18 字距 0.5、圖示 18。
 * outline＝1px 半透明框（清單、置中）；ghost＝無框（編輯工具列裡的工具）。
 */
const BTN_BASE =
  'inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium leading-[18px] tracking-[0.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#51A2FF]/60 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_OUTLINE = `${BTN_BASE} border border-[rgba(212,212,212,0.25)] text-[#D1D5DC] enabled:hover:bg-[rgba(209,213,220,0.08)]`
const INPUT_CLASS =
  'h-[34px] w-[120px] shrink-0 rounded-lg bg-[rgba(142,197,255,0.08)] px-3 py-1.5 text-sm leading-[18px] tracking-[0.5px] text-[#F3F4F6] outline-none placeholder:text-[#99A1AF] focus:ring-1 focus:ring-[#51A2FF]'

type ToolTone = 'blue' | 'amber' | 'emerald'

const ACTIVE_TONE: Record<ToolTone, string> = {
  blue: 'bg-[rgba(43,127,255,0.2)] text-[#51A2FF]',
  amber: 'bg-amber-950/70 text-amber-200',
  emerald: 'bg-emerald-950/70 text-emerald-200',
}

type ToolButtonProps = {
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  title?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  tone?: ToolTone
  testId?: string
  /** 窄畫面只留圖示（名稱在 tooltip） */
  compact?: boolean
}

/** 編輯工具列上的工具：無框，開啟中的切換鈕淡藍底 */
function ToolButton({
  Icon,
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  tone = 'blue',
  testId,
  compact = false,
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
        BTN_BASE,
        'px-2.5',
        active ? ACTIVE_TONE[tone] : 'text-[#D1D5DC] enabled:hover:bg-[rgba(209,213,220,0.08)]',
      ].join(' ')}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className={compact ? 'hidden xl:inline' : ''}>{label}</span>
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[rgba(212,212,212,0.15)]" aria-hidden />
}

/**
 * 地圖編輯器頂部工具列。
 *
 * <h3>第一列（設計稿）</h3>
 * 清單 ｜ 地圖名稱、版本 ｜（靠右）座標資訊框 ｜ 軌道檢查 ｜ 置中 ｜ 檢視／編輯切換。
 *
 * <h3>第二列（只有編輯模式）</h3>
 * 左邊是編輯用的工具：復原、重做、編修紀錄 ｜ 刻度、區域標示、工具列、裁減；
 * 右邊是自動儲存與發布狀態、「發布到正式環境」。檢視模式用不到，整列不出現。
 *
 * 縮放只靠滑鼠滾輪與觸控板（見 MapAreaCanvas 的 wheelZoomMode），不再有縮放列；
 * 測試器（斷路掃描、MQTT 模擬）已移除。
 */
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
  coordsText,
  canvasText,
  infoTitle,
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
  autosaving = false,
  autosaveLabel,
  syncFailed = false,
  retryingSync = false,
  onRetrySync,
  isPrimaryMap = false,
  onSetPrimaryMap,
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

  const hasTrackIssues = typeof trackIssueCount === 'number' && trackIssueCount > 0

  return (
    <div className="shrink-0" role="toolbar" aria-label={t('mapEditor.toolbar.aria')}>
      {/* 第一列 */}
      <div className="flex h-[60px] items-center gap-3 p-3">
        <button
          type="button"
          onClick={onBackToLibrary}
          className={BTN_OUTLINE}
          title={t('mapEditor.toolbar.backToList')}
        >
          <ArrowLeft className="size-[18px] shrink-0" aria-hidden />
          {t('mapEditor.toolbar.list')}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <input
            id="map-editor-display-name"
            aria-label={t('mapEditor.toolbar.mapName')}
            value={mapDisplayName}
            onChange={(e) => onMapDisplayNameChange(e.target.value)}
            className={INPUT_CLASS}
            title={mapDisplayName || t('mapEditor.toolbar.mapName')}
          />
          <input
            id="map-editor-version"
            aria-label={t('mapEditor.toolbar.version')}
            value={mapVersion}
            onChange={(e) => onMapVersionChange(e.target.value)}
            className={INPUT_CLASS}
            title={t('mapEditor.toolbar.version')}
          />

          <div
            className="ml-auto hidden h-[34px] min-w-0 items-center gap-3 rounded-lg xl:flex bg-[rgba(142,197,255,0.04)] px-4 py-2 text-sm leading-[18px] tracking-[0.5px] text-[#99A1AF]"
            role="status"
            aria-live="polite"
            title={infoTitle}
          >
            <span className="min-w-0 truncate">{coordsText}</span>
            <span className="h-[18px] w-px shrink-0 bg-[rgba(212,212,212,0.15)]" aria-hidden />
            <span className="hidden shrink-0 whitespace-nowrap md:inline">{canvasText}</span>
          </div>
        </div>

        {onToggleTrackIssues && (
          <button
            type="button"
            onClick={onToggleTrackIssues}
            aria-pressed={trackIssuesOpen}
            data-testid="track-check-button"
            className={`${BTN_OUTLINE} ${
              trackIssuesOpen ? 'border-[rgba(81,162,255,0.5)] text-[#51A2FF]' : ''
            }`}
            title={t('mapEditor.toolbar.trackCheckTitle')}
          >
            <ScanSearch className="size-[18px] shrink-0" aria-hidden />
            <span className="hidden 2xl:inline">{t('mapEditor.toolbar.trackCheck')}</span>
            {trackIssueCount === null ? null : hasTrackIssues ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-zinc-950">
                {trackIssueCount}
              </span>
            ) : (
              <span className="text-emerald-400" aria-label={t('mapEditor.toolbar.trackCheckOk')}>
                ✓
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onCenterMap}
          className={BTN_OUTLINE}
          title={t('mapEditor.toolbar.centerTitle')}
        >
          <Crosshair className="size-[18px] shrink-0" aria-hidden />
          {t('mapEditor.toolbar.center')}
        </button>

        {/* 檢視／編輯：切到檢視＝離開編輯（有變更會先詢問） */}
        <div
          className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-[rgba(212,212,212,0.15)] bg-[rgba(212,212,216,0.1)] p-1"
          role="radiogroup"
          aria-label={t('mapEditor.toolbar.modeAria')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!isEdit}
            onClick={() => {
              if (isEdit) onLeaveEdit()
            }}
            title={isEdit ? t('mapEditor.toolbar.leaveEditTitle') : undefined}
            className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-sm leading-[18px] tracking-[0.5px] transition ${
              !isEdit ? 'bg-[#2B7FFF] font-medium text-white' : 'text-[#6A7282] hover:text-[#D1D5DC]'
            }`}
          >
            <Eye className="size-4 shrink-0" aria-hidden />
            {t('mapEditor.toolbar.view')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isEdit}
            onClick={() => {
              if (!isEdit) onEnterEdit()
            }}
            title={isEdit ? undefined : t('mapEditor.toolbar.enterEditTitle')}
            className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-sm leading-[18px] tracking-[0.5px] transition ${
              isEdit ? 'bg-[#2B7FFF] font-medium text-white' : 'text-[#6A7282] hover:text-[#D1D5DC]'
            }`}
          >
            <Pencil className="size-4 shrink-0" aria-hidden />
            {t('mapEditor.toolbar.edit')}
          </button>
        </div>
      </div>

      {/* 第二列：編輯工具（只有編輯模式） */}
      {isEdit && (
        <div
          className="flex min-h-[46px] flex-wrap items-center gap-1 px-3 pb-3"
          role="group"
          aria-label={t('mapEditor.toolbar.editToolsAria')}
        >
          <ToolButton
            Icon={Undo2}
            label={t('mapEditor.toolbar.undo')}
            title={t('mapEditor.toolbar.undoTitle')}
            onClick={onUndo}
            disabled={!canUndo}
            compact
          />
          <ToolButton
            Icon={Redo2}
            label={t('mapEditor.toolbar.redo')}
            title={t('mapEditor.toolbar.redoTitle')}
            onClick={onRedo}
            disabled={!canRedo}
            compact
          />
          {onOpenRevisionHistory && (
            <ToolButton
              Icon={History}
              label={t('mapEditor.toolbar.revisionHistory')}
              title={t('mapEditor.toolbar.revisionHistoryTitle')}
              onClick={onOpenRevisionHistory}
              compact
            />
          )}
          <Divider />
          {(onCycleRulerDisplayMode || onToggleRulers) && (
            <ToolButton
              Icon={Ruler}
              label={rulerLabel}
              title={rulerTitle}
              onClick={onCycleRulerDisplayMode ?? onToggleRulers}
              active={rulerActive}
              tone={rulerDisplayMode === 'field' ? 'emerald' : 'blue'}
            />
          )}
          {onToggleAreaCenterLabels && (
            <ToolButton
              Icon={Highlighter}
              label={t('mapEditor.toolbar.areaLabels')}
              title={areaCenterLabelsToggleHint ?? t('mapEditor.toolbar.areaLabelsTitle')}
              onClick={onToggleAreaCenterLabels}
              active={showAreaCenterLabels}
            />
          )}
          {onToggleFacilityToolbars && (
            <ToolButton
              Icon={Component}
              label={t('mapEditor.toolbar.facilityBars')}
              title={facilityToolbarsToggleHint ?? t('mapEditor.toolbar.facilityBarsTitle')}
              onClick={onToggleFacilityToolbars}
              active={showFacilityToolbars}
            />
          )}
          {onToggleMapCanvasResize && (
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
                  className={`${BTN_BASE} border border-amber-600/70 bg-amber-950/70 text-amber-100 hover:bg-amber-900/60`}
                  title={t('mapEditor.toolbar.applyCropTitle')}
                >
                  {t('mapEditor.toolbar.applyCrop')}
                </button>
              ) : null}
              {mapCanvasResizeActive && onCancelMapCrop ? (
                <button
                  type="button"
                  onClick={onCancelMapCrop}
                  className={`${BTN_BASE} text-[#99A1AF] hover:bg-[rgba(209,213,220,0.08)] hover:text-[#D1D5DC]`}
                  title={t('mapEditor.toolbar.cancelCropTitle')}
                >
                  {t('mapEditor.toolbar.cancel')}
                </button>
              ) : null}
            </>
          )}

          {/*
            右：自動儲存狀態。每次儲存都送後端，沒有「發布」這一步；哪一張是系統在讀的，
            由地圖清單的「設為主要地圖」決定。
          */}
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm leading-[18px] tracking-[0.5px]">
            {!isPrimaryMap && onSetPrimaryMap && (
              <ToolButton
                Icon={MapPin}
                label={t('mapLibrary.setActive')}
                title={t('mapLibrary.setActiveTitle')}
                onClick={onSetPrimaryMap}
                compact
              />
            )}
            {isPrimaryMap && (
              <span
                className="inline-flex h-[26px] items-center gap-1 rounded-lg bg-[rgba(0,212,146,0.2)] px-3 text-sm font-medium text-[#F3F4F6]"
                title={t('mapEditor.chrome.primaryMapLiveTitle')}
              >
                <span className="size-2 rounded-full bg-[#00D492]" aria-hidden />
                {t('mapEditor.chrome.primaryMapLive')}
              </span>
            )}
            {syncFailed ? (
              <>
                <span className="text-amber-300">{t('mapEditor.chrome.syncFailed')}</span>
                {onRetrySync && (
                  <button
                    type="button"
                    onClick={onRetrySync}
                    disabled={retryingSync}
                    className={`${BTN_BASE} border border-amber-600/60 text-amber-200 enabled:hover:bg-amber-950/60`}
                  >
                    {retryingSync && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
                    {t('mapEditor.chrome.retrySync')}
                  </button>
                )}
              </>
            ) : (
              <span className="hidden items-center gap-1.5 text-[#99A1AF] sm:inline-flex">
                {autosaving && <Loader2 className="size-3.5 shrink-0 animate-spin text-[#51A2FF]" aria-hidden />}
                {autosaveLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
