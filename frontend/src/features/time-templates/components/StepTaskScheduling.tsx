import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  ChevronDown,
  Info,
  Plus,
  Redo2,
  ScanSearch,
  SlidersHorizontal,
  Tag,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  PERIOD_LEGEND_FALLBACK,
  SCHEDULE_ROW_COUNT_MAX,
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_SLOT_WIDTH_DEFAULT,
  SCHEDULE_SLOT_WIDTH_MIN,
  SCHEDULE_VISIBLE_SLOTS,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  SCHEDULE_TIME_AXIS_TEXT_INACTIVE_CLASS,
  SCHEDULE_DAY_MINUTES,
  TASK_TYPE_OPTIONS,
  TASK_TYPE_COLORS,
  buildAttributeIntervalLegends,
  clampRangeEndToActiveIntervals,
  clampRangeEndAwayFromOverlappingTasks,
  clampRangeStartToActiveIntervals,
  clampRangeStartAwayFromOverlappingTasks,
  clampTaskMoveStart,
  buildTasksToFillEmptyScheduleSlots,
  createScheduleTask,
  formatMinutesToTime,
  hexToRgba,
  getInactiveRangesWithinBar,
  isScheduleSlotActive,
  listScheduleTimeGaps,
  parseIntervalMinuteRanges,
  clampScheduleMinute,
  updateScheduleTask,
  type ScheduleTask,
  type ScheduleTimeGap,
  type TaskTypeKey,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';
import { PanelNoData } from './PanelNoData';
import { FillEmptySlotsConfirmModal } from './FillEmptySlotsConfirmModal';
import { TaskTypeHelpAnchor } from './TaskTypeHelpAnchor';
import { AttributeLegendBadgeChip } from './AttributeLegendBadgeChip';
import { ScheduleTimelineBackground } from './scheduleTimelineBackground';
import {
  ScheduleIntervalColumnHighlight,
  ScheduleIntervalHeaderColumnHighlight,
  ScheduleIntervalHeaderHits,
} from './ScheduleIntervalSelection';
import { TaskSettingsForm, type TaskSettingsFormHandle } from './TaskSettingsForm';
import { ScrollPinnedCardLabel } from '../../../components/ScrollPinnedCardLabel';
import {
  isWithinDayCycleWindow,
  useDayCycleGridScroll,
} from '../../../components/scheduleGridDayCycle';
import { TurnaroundLimitGrid } from './TurnaroundLimitGrid';

const TASK_SETTINGS_FORM_ID = 'schedule-task-settings-form';
const ROW_HEIGHT_PX = 36;
const ROW_LABEL_WIDTH = 48;
/** 任務塊左右緣可拖曳調整寬度的感應寬度（px） */
const TASK_RESIZE_HIT_PX = 14;
const TASK_RESIZE_HANDLE_HEIGHT_PX = 18;
const TASK_RESIZE_HANDLE_WIDTH_PX = 3;

function slotWidthFromSlider(value: number): number {
  const t = value / 100;
  return Math.round(
    SCHEDULE_SLOT_WIDTH_MIN
      + t * (SCHEDULE_SLOT_WIDTH_DEFAULT - SCHEDULE_SLOT_WIDTH_MIN),
  );
}

function sliderFromSlotWidth(width: number): number {
  const span = SCHEDULE_SLOT_WIDTH_DEFAULT - SCHEDULE_SLOT_WIDTH_MIN;
  if (span <= 0) return 100;
  const clamped = Math.min(SCHEDULE_SLOT_WIDTH_DEFAULT, Math.max(SCHEDULE_SLOT_WIDTH_MIN, width));
  return Math.round(((clamped - SCHEDULE_SLOT_WIDTH_MIN) / span) * 100);
}

function ScheduleTimeZoomSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="schedule-time-zoom-slider w-28 shrink-0"
      style={{ ['--fill' as string]: `${value}%` }}
      aria-label="時軸縮放"
    />
  );
}

type ScheduleViewMode = 'split' | 'expand';

type ScheduleHistorySnapshot = {
  tasks: ScheduleTask[];
  rowCount: number;
};

function ScheduleToolbarIconButton({
  label,
  onClick,
  disabled = false,
  active = false,
  flash = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  flash?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex size-8 items-center justify-center rounded-lg transition ${
        flash ? 'schedule-history-flash' : ''
      } ${
        active
          ? 'text-zinc-200 hover:bg-zinc-800/80'
          : 'text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300'
      } disabled:cursor-not-allowed disabled:opacity-35`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ScheduleExpandIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5.5 2.75H3.25a.5.5 0 0 0-.5.5V5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 2.75h2.25a.5.5 0 0 1 .5.5V5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 13.25h2.25a.5.5 0 0 0 .5-.5V11"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 13.25H3.25a.5.5 0 0 1-.5-.5V11"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScheduleShrinkIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.25 2.75H3.25a.5.5 0 0 0-.5.5v3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.75 2.75h3a.5.5 0 0 1 .5.5v3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.75 13.25h3a.5.5 0 0 0 .5-.5v-3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.25 13.25h-3a.5.5 0 0 1-.5-.5v-3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarPanelToggleIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2.25"
        y="3.25"
        width="11.5"
        height="9.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <line
        x1="10.25"
        y1="3.25"
        x2="10.25"
        y2="12.75"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      {filled ? (
        <rect x="10.25" y="3.25" width="3.5" height="9.5" rx="0 1.5 1.5 0" fill="currentColor" />
      ) : null}
    </svg>
  );
}

function ScheduleViewModeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex size-8 items-center justify-center rounded-lg transition ${
        active
          ? 'bg-[rgba(43,127,255,0.24)] text-[#51A2FF]'
          : 'text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300'
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ScheduleTaskToolbar({
  zoomValue,
  viewMode,
  fullscreen,
  canDeleteSelected,
  canUndo,
  canRedo,
  undoFlash,
  redoFlash,
  onDeleteSelected,
  onUndo,
  onRedo,
  onZoomChange,
  onViewModeChange,
  onFullscreenChange,
  inline = false,
  estimatedTripSeconds,
  onEstimatedTripSecondsChange,
}: {
  zoomValue: number;
  viewMode: ScheduleViewMode;
  fullscreen: boolean;
  canDeleteSelected: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoFlash: boolean;
  redoFlash: boolean;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (value: number) => void;
  onViewModeChange: (mode: ScheduleViewMode) => void;
  onFullscreenChange: (next: boolean) => void;
  inline?: boolean;
  estimatedTripSeconds: number;
  onEstimatedTripSecondsChange: (value: number) => void;
}) {
  /**
   * 編輯中的原始字串。
   *
   * 直接把 `value` 綁在數字上、又只在「解析得出正數」時才往上送，等於
   * <strong>清空這個動作永遠不會被接受</strong>——使用者刪光數字時 onChange 收到
   * 空字串、解析成 NaN、不呼叫回調，React 隨即用舊的數字重繪，游標前的字就這樣
   * 長回來，看起來像刪不掉。中間狀態（空字串、只打了「0」）必須先讓它存在，
   * 只把<strong>有效值</strong>往上送；離開欄位時再把顯示拉回已接受的值。
   */
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div
      className={`flex shrink-0 items-center justify-between gap-3 ${
        inline ? '' : 'border-b border-zinc-800/60 px-3 py-2'
      }`}
      role="toolbar"
      aria-label="任務排班工具列"
    >
      {/* 左側：來回一趟預估秒數（供建議列數） */}
      <div className="flex items-center gap-1.5" title="請填來回一趟的預估秒數（含各方向與折返），不是單線。建議列數＝ceil(此值÷班距)；短時段會再建議多 1 列。">
        <label className="text-[11px] text-zinc-500 whitespace-nowrap">來回預估秒數:</label>
        <input
          type="number"
          min={1}
          step={10}
          value={draft ?? String(estimatedTripSeconds)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const v = Number.parseInt(raw, 10);
            if (Number.isFinite(v) && v > 0) onEstimatedTripSecondsChange(v);
          }}
          onBlur={() => setDraft(null)}
          className="h-[26px] w-[72px] rounded-md border border-zinc-700/60 bg-zinc-900/80 px-2 text-center text-[11px] tabular-nums text-zinc-200 outline-none focus:border-zinc-500"
          placeholder="600"
        />
        <span className="text-[10px] text-zinc-600 whitespace-nowrap">秒（建議列數用）</span>
      </div>

      {/* 右側：操作按鈕群組 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <ScheduleToolbarIconButton
            label="刪除選取任務"
            onClick={onDeleteSelected}
            disabled={!canDeleteSelected}
            active={canDeleteSelected}
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </ScheduleToolbarIconButton>
          <ScheduleToolbarIconButton
            label="復原 (⌘Z)"
            onClick={onUndo}
            disabled={!canUndo}
            flash={undoFlash}
          >
            <Undo2 className="size-4" strokeWidth={1.75} />
          </ScheduleToolbarIconButton>
          <ScheduleToolbarIconButton
            label="重做 (⌘⇧Z)"
            onClick={onRedo}
            disabled={!canRedo}
            flash={redoFlash}
          >
            <Redo2 className="size-4" strokeWidth={1.75} />
          </ScheduleToolbarIconButton>
        </div>
        <ScheduleTimeZoomSlider value={zoomValue} onChange={onZoomChange} />
        <ScheduleViewModeButton
          label={viewMode === 'split' ? '關閉右側面板' : '開啟右側面板'}
          active={viewMode === 'split'}
          onClick={() => onViewModeChange(viewMode === 'split' ? 'expand' : 'split')}
        >
          <SidebarPanelToggleIcon filled={viewMode === 'split'} />
        </ScheduleViewModeButton>
        <ScheduleToolbarIconButton
          label={fullscreen ? '離開全螢幕' : '全螢幕'}
          onClick={() => onFullscreenChange(!fullscreen)}
        >
          {fullscreen ? <ScheduleShrinkIcon /> : <ScheduleExpandIcon />}
        </ScheduleToolbarIconButton>
      </div>
    </div>
  );
}

function formatSlotLabel(slotIndex: number): string {
  const totalMinutes = slotIndex * SCHEDULE_SLOT_MINUTES;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ── Period Legend (time-slot interval tabs) ── */

function PeriodLegend({
  intervals,
  attributes,
  highlightedAttributeId,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  highlightedAttributeId?: string | null;
}) {
  const legends = useMemo(
    () =>
      buildAttributeIntervalLegends(
        intervals.filter((slot) => !slot.isDraft),
        attributes.filter((attr) => !attr.isDraft),
      ),
    [attributes, intervals],
  );

  if (legends.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_LEGEND_FALLBACK.map((tag) => (
          <span
            key={tag.label}
            className={`inline-flex h-[26px] items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium ${tag.chipClass}`}
          >
            {tag.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {legends.map((item) => (
        <AttributeLegendBadgeChip
          key={item.attributeId}
          item={item}
          highlighted={highlightedAttributeId === item.attributeId}
        />
      ))}
    </div>
  );
}

function isColActive(col: number, activeRanges: ReturnType<typeof parseIntervalMinuteRanges>): boolean {
  return isScheduleSlotActive(col, SCHEDULE_SLOT_MINUTES, activeRanges);
}

/* ── Draggable Task Type Chip ── */

function TaskTypeChip({
  taskKey,
  label,
}: {
  taskKey: TaskTypeKey;
  label: string;
}) {
  const colors = TASK_TYPE_COLORS[taskKey];
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('application/x-task-type', taskKey);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <TaskTypeHelpAnchor
      taskKey={taskKey}
      draggable
      onDragStart={handleDragStart}
      className="isolate relative inline-flex h-[32px] cursor-grab items-center justify-center overflow-hidden whitespace-nowrap rounded px-3 text-sm font-normal leading-[18px] tracking-[0.5px] transition select-none hover:brightness-110 active:cursor-grabbing"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: colors.bar }}
        aria-hidden
      />
      <span className="relative z-[1]">{label}</span>
    </TaskTypeHelpAnchor>
  );
}

/* ── Fill empty schedule slots ── */

const FILL_TASK_SELECT_CLASS =
  'h-8 w-full min-w-0 rounded-lg bg-zinc-900/80 px-2.5 text-xs leading-[18px] text-[#D1D5DC] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/40';

function FillEmptySlotsControl({
  disabled,
  onConfirmFill,
}: {
  disabled: boolean;
  onConfirmFill: (taskType: TaskTypeKey) => void;
}) {
  const [taskType, setTaskType] = useState<TaskTypeKey>('servicing');
  const [showConfirm, setShowConfirm] = useState(false);
  const taskLabel = TASK_TYPE_OPTIONS.find((t) => t.key === taskType)?.label ?? taskType;

  return (
    <>
      <div className="mt-3 flex items-center gap-2 border-t border-zinc-800/60 pt-3">
        <div className="relative min-w-0 flex-1">
          <select
            value={taskType}
            disabled={disabled}
            onChange={(e) => setTaskType(e.target.value as TaskTypeKey)}
            className={`${FILL_TASK_SELECT_CLASS} appearance-none pr-7 disabled:cursor-not-allowed disabled:opacity-40`}
            aria-label="補滿剩餘任務格類型"
          >
            {TASK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key} className="bg-zinc-900">
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowConfirm(true)}
          className="h-8 shrink-0 rounded-lg bg-[#2B7FFF] px-2.5 text-xs font-medium text-white transition hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          補滿剩餘任務格
        </button>
      </div>
      {showConfirm && (
        <FillEmptySlotsConfirmModal
          taskLabel={taskLabel}
          onClose={() => setShowConfirm(false)}
          onConfirm={() => {
            setShowConfirm(false);
            onConfirmFill(taskType);
          }}
        />
      )}
    </>
  );
}

function ScheduleGapCheckButton({
  gaps,
  onJump,
}: {
  gaps: ScheduleTimeGap[];
  onJump: () => void;
}) {
  const hasGaps = gaps.length > 0;
  return (
    <button
      type="button"
      disabled={!hasGaps}
      onClick={onJump}
      className={`mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition ${
        hasGaps
          ? 'border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
          : 'cursor-not-allowed border border-zinc-800 bg-zinc-900/60 text-zinc-600'
      }`}
      title={
        hasGaps
          ? `發現 ${gaps.length} 處時間缺漏，點擊跳至下一處`
          : '營運時段內任務已填滿，無需檢查'
      }
    >
      <ScanSearch className="size-3.5 shrink-0" aria-hidden />
      時間缺漏檢查
      {hasGaps ? (
        <span className="rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-100">
          {gaps.length}
        </span>
      ) : null}
    </button>
  );
}

/* ── Sidebar Card ── */

function SidebarCard({
  icon,
  title,
  headerAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/50">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          {icon}
          {title}
        </div>
        {headerAction}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

type ResizeEdge = 'left' | 'right';

type ResizePreview = {
  edge: ResizeEdge;
  minute: number;
};

type MovePreview = {
  minute: number;
};

function TaskBar({
  task,
  selected,
  slotWidthPx,
  trackOffsetPx,
  activeIntervalRanges,
  resizePreview,
  movePreview,
  isDragging,
  onSelect,
  onDelete,
  onResize,
  onMove,
}: {
  task: ScheduleTask;
  selected: boolean;
  slotWidthPx: number;
  /**
   * 這一份日拷貝的軌道左緣在捲動內容座標系裡的位置
   * （列號欄寬度 ＋ 第幾份 × 一日寬度）。條上的文字要跟著捲動貼齊可視左緣，
   * 得知道自己在整份內容裡的絕對位置。
   */
  trackOffsetPx: number;
  activeIntervalRanges: ReturnType<typeof parseIntervalMinuteRanges>;
  resizePreview?: ResizePreview | null;
  movePreview?: MovePreview | null;
  isDragging?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResize: (edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => void;
  onMove: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoveredEdge, setHoveredEdge] = useState<ResizeEdge | null>(null);
  const colors = TASK_TYPE_COLORS[task.taskType];
  const widthPx = (task.durationMinutes / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
  const leftPx = (task.startMinute / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
  const endMinute = task.startMinute + task.durationMinutes;
  /**
   * 跨午夜的任務條<strong>不必切成兩段畫</strong>。
   *
   * 格線是日循環無限捲動的，三份日拷貝實體相鄰而且軌道沒有 overflow 裁切，
   * 所以一根從 23:40 長 40 分鐘的條子畫成單一個 div、寬度照時長算，
   * 自然就會越過本份的右緣、落在下一份拷貝的左緣——那裡正好是隔天的 00:00。
   * 看起來就是連續的一根。
   *
   * 卡面時刻要繞回鐘面：結束落在 1440 之後時該寫 00:20，不是 24:20。
   */
  const timeLabel =
    `${formatMinutesToTime(task.startMinute)}-`
    + `${formatMinutesToTime(endMinute % SCHEDULE_DAY_MINUTES)}`;
  const inactiveRanges = useMemo(
    () => getInactiveRangesWithinBar(task.startMinute, endMinute, activeIntervalRanges),
    [task.startMinute, endMinute, activeIntervalRanges],
  );


  const resolveResizeEdge = useCallback(
    (clientX: number, target: EventTarget | null): ResizeEdge | null => {
      if (!selected) return null;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = clientX - rect.left;
      if (x <= TASK_RESIZE_HIT_PX) return 'left';
      if (x >= rect.width - TASK_RESIZE_HIT_PX) {
        if (target instanceof Element && target.closest('[data-task-delete]')) return null;
        return 'right';
      }
      return null;
    },
    [selected],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!selected || isDragging) {
        setHoveredEdge(null);
        return;
      }
      setHoveredEdge(resolveResizeEdge(event.clientX, event.target));
    },
    [isDragging, resolveResizeEdge, selected],
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  useEffect(() => {
    if (!selected) setHoveredEdge(null);
  }, [selected]);

  const activeResizeEdge = resizePreview?.edge ?? hoveredEdge;
  const barCursor = isDragging
    ? 'grabbing'
    : selected && hoveredEdge
      ? 'ew-resize'
      : 'grab';

  return (
    <div
      ref={barRef}
      className="absolute top-[2px] isolate overflow-hidden rounded-[4px] transition-shadow"
      style={{
        left: leftPx,
        width: widthPx,
        height: ROW_HEIGHT_PX - 4,
        backgroundColor: colors.bg,
        boxShadow: selected ? `0 0 0 1.5px ${colors.bar}` : 'none',
        cursor: barCursor,
        zIndex: selected || isDragging ? 5 : 1,
        touchAction: 'none',
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const edge = resolveResizeEdge(e.clientX, e.target);
        if (edge) {
          onResize(edge, e);
          return;
        }
        onMove(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {inactiveRanges.map((range) => {
        const leftPct = ((range.start - task.startMinute) / task.durationMinutes) * 100;
        const widthPct = ((range.end - range.start) / task.durationMinutes) * 100;
        return (
          <div
            key={`${range.start}-${range.end}`}
            className="schedule-task-inactive-overlay pointer-events-none absolute inset-y-0 z-[4]"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            aria-hidden
          />
        );
      })}
      {selected && activeResizeEdge && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-[24] w-1"
            style={{
              left: activeResizeEdge === 'left' ? 0 : undefined,
              right: activeResizeEdge === 'right' ? 0 : undefined,
              backgroundColor: colors.bar,
              boxShadow: `0 0 8px ${hexToRgba(colors.bar, 0.85)}`,
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute top-1/2 z-[25] -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.45)]"
            style={{
              left: activeResizeEdge === 'left' ? 3 : undefined,
              right: activeResizeEdge === 'right' ? 3 : undefined,
              width: TASK_RESIZE_HANDLE_WIDTH_PX,
              height: TASK_RESIZE_HANDLE_HEIGHT_PX,
            }}
            aria-hidden
          />
        </>
      )}
      {selected && resizePreview && (
        <div
          className={`pointer-events-none absolute -top-7 z-30 whitespace-nowrap rounded border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-100 shadow-lg ${
            resizePreview.edge === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
          }`}
        >
          {formatMinutesToTime(resizePreview.minute)}
        </div>
      )}
      {movePreview && (
        <div className="pointer-events-none absolute -top-7 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded border border-zinc-700/80 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-100 shadow-lg">
          {formatMinutesToTime(movePreview.minute)}–{formatMinutesToTime(movePreview.minute + task.durationMinutes)}
        </div>
      )}
      {/* Left accent bar — Figma 4px */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-1"
        style={{ backgroundColor: colors.bar }}
      />
      {/* 文字捲到哪跟到哪，貼齊可視左緣直到條子捲完；跟班表調整同一支元件 */}
      <div className="pointer-events-none absolute inset-0 z-[6] flex items-center px-1.5">
        <ScrollPinnedCardLabel
          cardLeftPx={trackOffsetPx + leftPx}
          cardWidthPx={widthPx}
          rowLabelWidth={ROW_LABEL_WIDTH}
          className="w-fit min-w-0 max-w-full truncate text-left text-[10px] font-normal leading-[18px] tracking-[0.5px] will-change-transform"
        >
          <span style={{ color: colors.text }}>
            {task.label}
            <span className="opacity-70"> | {timeLabel}</span>
          </span>
        </ScrollPinnedCardLabel>
      </div>
      {selected && (
        <button
          type="button"
          data-task-delete
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute right-3 top-1/2 z-[11] flex size-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          aria-label="刪除任務"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ── Main Component ── */

type StepTaskSchedulingProps = {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  tasks: ScheduleTask[];
  rowCount: number;
  fullscreen: boolean;
  panelTitle?: string;
  onFullscreenChange: (next: boolean) => void;
  onRowCountChange: (count: number) => void;
  onTasksChange: (tasks: ScheduleTask[]) => void;
};

export function StepTaskScheduling({
  intervals,
  attributes,
  tasks,
  rowCount,
  fullscreen,
  panelTitle,
  onFullscreenChange,
  onRowCountChange,
  onTasksChange,
}: StepTaskSchedulingProps) {
  const [slotWidthPx, setSlotWidthPx] = useState(SCHEDULE_SLOT_WIDTH_DEFAULT);
  // 日循環無限捲動：左右各接一份一模一樣的一天，跟班表調整那邊同一套機制
  const {
    scrollRef: gridRef,
    dayWidthPx,
    totalTrackWidthPx,
    dayCopies,
    viewWindow,
  } = useDayCycleGridScroll<HTMLDivElement>({
    slotWidthPx,
    slotMinutes: SCHEDULE_SLOT_MINUTES,
    rowLabelWidth: ROW_LABEL_WIDTH,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedIntervalId, setSelectedIntervalId] = useState<string | null>(null);
  const [estimatedTripSeconds, setEstimatedTripSeconds] = useState(600);
  const [taskFormDirty, setTaskFormDirty] = useState(false);
  const [taskFormCanConfirm, setTaskFormCanConfirm] = useState(false);
  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    taskId: string;
    edge: ResizeEdge;
    minute: number;
  } | null>(null);
  const [movePreview, setMovePreview] = useState<{
    taskId: string;
    minute: number;
  } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('split');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyFlash, setHistoryFlash] = useState<'undo' | 'redo' | null>(null);
  const [highlightedGap, setHighlightedGap] = useState<ScheduleTimeGap | null>(null);
  const [gapJumpIndex, setGapJumpIndex] = useState(0);

  const gapHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskSettingsFormRef = useRef<TaskSettingsFormHandle>(null);
  const tasksRef = useRef(tasks);
  const rowCountRef = useRef(rowCount);
  const historyPastRef = useRef<ScheduleHistorySnapshot[]>([]);
  const historyFutureRef = useRef<ScheduleHistorySnapshot[]>([]);
  const isApplyingHistoryRef = useRef(false);

  tasksRef.current = tasks;
  rowCountRef.current = rowCount;

  const cloneSnapshot = useCallback((): ScheduleHistorySnapshot => ({
    tasks: tasksRef.current.map((task) => ({ ...task })),
    rowCount: rowCountRef.current,
  }), []);

  const pushHistory = useCallback(() => {
    if (isApplyingHistoryRef.current) return;
    historyPastRef.current.push(cloneSnapshot());
    if (historyPastRef.current.length > 100) {
      historyPastRef.current.shift();
    }
    historyFutureRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, [cloneSnapshot]);

  const flashHistoryAction = useCallback((kind: 'undo' | 'redo') => {
    setHistoryFlash(kind);
    window.setTimeout(() => setHistoryFlash(null), 400);
  }, []);

  const applySnapshot = useCallback(
    (snapshot: ScheduleHistorySnapshot) => {
      isApplyingHistoryRef.current = true;
      onTasksChange(snapshot.tasks);
      onRowCountChange(snapshot.rowCount);
      setSelectedTaskId(null);
      isApplyingHistoryRef.current = false;
      setHistoryVersion((version) => version + 1);
    },
    [onRowCountChange, onTasksChange],
  );

  const undo = useCallback(() => {
    const previous = historyPastRef.current.pop();
    if (!previous) return;
    historyFutureRef.current.push(cloneSnapshot());
    applySnapshot(previous);
    flashHistoryAction('undo');
  }, [applySnapshot, cloneSnapshot, flashHistoryAction]);

  const redo = useCallback(() => {
    const next = historyFutureRef.current.pop();
    if (!next) return;
    historyPastRef.current.push(cloneSnapshot());
    applySnapshot(next);
    flashHistoryAction('redo');
  }, [applySnapshot, cloneSnapshot, flashHistoryAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTaskId(null);
        setSelectedIntervalId(null);
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const canUndo = historyPastRef.current.length > 0;
  const canRedo = historyFutureRef.current.length > 0;
  void historyVersion;

  useEffect(() => {
    setTaskFormDirty(false);
    setTaskFormCanConfirm(false);
  }, [selectedTaskId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable
          || target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT')
      ) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key === 'y' || (event.key === 'z' && event.shiftKey) || (event.key === 'Z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const timeSlots = Array.from({ length: SCHEDULE_VISIBLE_SLOTS }, (_, i) => i);
  const rows = Array.from({ length: rowCount }, (_, i) => i + 1);
  const activeIntervalRanges = useMemo(
    () => parseIntervalMinuteRanges(intervals),
    [intervals],
  );

  const scheduleGaps = useMemo(
    () => listScheduleTimeGaps(rowCount, tasks, activeIntervalRanges),
    [activeIntervalRanges, rowCount, tasks],
  );

  useEffect(() => {
    if (scheduleGaps.length === 0) {
      setGapJumpIndex(0);
      setHighlightedGap(null);
      return;
    }
    setGapJumpIndex((prev) => prev % scheduleGaps.length);
  }, [scheduleGaps]);

  useEffect(() => {
    return () => {
      if (gapHighlightTimerRef.current) clearTimeout(gapHighlightTimerRef.current);
    };
  }, []);

  const jumpToNextScheduleGap = useCallback(() => {
    if (scheduleGaps.length === 0) return;
    const index = gapJumpIndex % scheduleGaps.length;
    const gap = scheduleGaps[index]!;
    setGapJumpIndex((index + 1) % scheduleGaps.length);
    setHighlightedGap(gap);
    if (gapHighlightTimerRef.current) clearTimeout(gapHighlightTimerRef.current);
    gapHighlightTimerRef.current = setTimeout(() => setHighlightedGap(null), 2400);

    const grid = gridRef.current;
    if (!grid) return;
    // 缺口在中間那一份日拷貝上；少加一天會跳到左邊那份（畫面一樣，但接著會被拉回來）
    const leftPx =
      ROW_LABEL_WIDTH
      + dayWidthPx
      + (gap.start / SCHEDULE_SLOT_MINUTES) * slotWidthPx
      - grid.clientWidth * 0.18;
    const rowEl = grid.querySelector(
      `[data-schedule-row="${gap.rowIndex}"]`,
    ) as HTMLElement | null;
    const topPx = rowEl
      ? Math.max(0, rowEl.offsetTop - grid.clientHeight * 0.25)
      : grid.scrollTop;
    grid.scrollTo({
      left: Math.max(0, leftPx),
      top: topPx,
      behavior: 'smooth',
    });
  }, [dayWidthPx, gapJumpIndex, gridRef, scheduleGaps, slotWidthPx]);

  const highlightedAttributeId = useMemo(() => {
    if (!selectedIntervalId) return null;
    return intervals.find((slot) => slot.id === selectedIntervalId)?.attributeId ?? null;
  }, [intervals, selectedIntervalId]);

  const trackWidthPx = SCHEDULE_VISIBLE_SLOTS * slotWidthPx;

  const toggleIntervalSelection = useCallback((intervalId: string | null) => {
    setSelectedIntervalId(intervalId);
  }, []);

  /* ── Drag & Drop handlers ── */

  const handleDragOver = useCallback(
    (e: React.DragEvent, row: number, col: number) => {
      if (!e.dataTransfer.types.includes('application/x-task-type')) return;
      e.preventDefault();
      const canDrop = isScheduleSlotActive(col, SCHEDULE_SLOT_MINUTES, activeIntervalRanges);
      e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
      setDragOverCell(canDrop ? { row, col } : null);
    },
    [activeIntervalRanges],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, row: number, col: number) => {
      e.preventDefault();
      setDragOverCell(null);
      if (!isScheduleSlotActive(col, SCHEDULE_SLOT_MINUTES, activeIntervalRanges)) return;
      const taskType = e.dataTransfer.getData('application/x-task-type') as TaskTypeKey;
      if (!taskType) return;
      const startMinute = col * SCHEDULE_SLOT_MINUTES;
      const newTask = createScheduleTask(row, taskType, startMinute);
      pushHistory();
      onTasksChange([...tasks, newTask]);
      setSelectedTaskId(newTask.id);
    },
    [tasks, onTasksChange, activeIntervalRanges, pushHistory],
  );

  const deleteTask = useCallback(
    (id: string, recordHistory = true) => {
      if (recordHistory) pushHistory();
      onTasksChange(tasks.filter((t) => t.id !== id));
      if (selectedTaskId === id) setSelectedTaskId(null);
    },
    [tasks, onTasksChange, selectedTaskId, pushHistory],
  );

  const deleteSelectedTask = useCallback(() => {
    if (!selectedTaskId) return;
    deleteTask(selectedTaskId);
  }, [deleteTask, selectedTaskId]);

  const addRow = useCallback(() => {
    pushHistory();
    onRowCountChange(Math.min(SCHEDULE_ROW_COUNT_MAX, rowCount + 1));
  }, [onRowCountChange, rowCount, pushHistory]);

  const fillEmptySlots = useCallback(
    (taskType: TaskTypeKey) => {
      if (activeIntervalRanges.length === 0) return;

      const newTasks = buildTasksToFillEmptyScheduleSlots(
        rowCount,
        tasks,
        activeIntervalRanges,
        taskType,
      );
      if (newTasks.length === 0) return;

      pushHistory();
      onTasksChange([...tasks, ...newTasks]);
    },
    [activeIntervalRanges, onTasksChange, pushHistory, rowCount, tasks],
  );

  const updateTask = useCallback(
    (taskId: string, patch: Partial<ScheduleTask>) => {
      onTasksChange(updateScheduleTask(tasks, taskId, patch));
    },
    [tasks, onTasksChange],
  );

  const handleTaskResizeStart = useCallback(
    (taskId: string, edge: ResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      pushHistory();
      const startX = event.clientX;
      const initialStart = task.startMinute;
      const initialEnd = task.startMinute + task.durationMinutes;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const pxPerMinute = slotWidthPx / SCHEDULE_SLOT_MINUTES;

      const onPointerMove = (ev: PointerEvent) => {
        const deltaPx = ev.clientX - startX;
        const deltaMinutes = Math.round(deltaPx / pxPerMinute);

        if (edge === 'right') {
          // 上限是「起點 + 一整天」，不是 24:00——任務條可以跨午夜，
          // 夾在 24:00 會讓右緣拖到午夜就再也拉不動
          const rawEnd = Math.max(
            initialStart + 1,
            Math.min(initialStart + SCHEDULE_DAY_MINUTES, initialEnd + deltaMinutes),
          );
          const endInActive = clampRangeEndToActiveIntervals(
            initialStart,
            rawEnd,
            activeIntervalRanges,
          );
          const nextEnd = clampRangeEndAwayFromOverlappingTasks(
            taskId,
            task.rowIndex,
            initialStart,
            endInActive,
            tasks,
          );
          setResizePreview({ taskId, edge, minute: nextEnd });
          updateTask(taskId, { durationMinutes: nextEnd - initialStart });
          return;
        }

        const rawStart = clampScheduleMinute(
          Math.max(0, Math.min(initialEnd - 1, initialStart + deltaMinutes)),
        );
        const startInActive = clampRangeStartToActiveIntervals(
          rawStart,
          initialEnd,
          activeIntervalRanges,
        );
        const nextStart = clampRangeStartAwayFromOverlappingTasks(
          taskId,
          task.rowIndex,
          startInActive,
          initialEnd,
          tasks,
        );
        setResizePreview({ taskId, edge, minute: nextStart });
        updateTask(taskId, {
          startMinute: nextStart,
          durationMinutes: initialEnd - nextStart,
        });
      };

      const onPointerUp = () => {
        setResizePreview(null);
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [tasks, updateTask, slotWidthPx, activeIntervalRanges, pushHistory],
  );

  const handleTaskMoveStart = useCallback(
    (taskId: string, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      pushHistory();
      const startX = event.clientX;
      const initialStart = task.startMinute;
      const duration = task.durationMinutes;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setSelectedTaskId(taskId);

      const pxPerMinute = slotWidthPx / SCHEDULE_SLOT_MINUTES;
      let moved = false;

      const onPointerMove = (ev: PointerEvent) => {
        const deltaPx = ev.clientX - startX;
        if (!moved && Math.abs(deltaPx) < 2) return;
        moved = true;
        setDraggingTaskId(taskId);

        const deltaMinutes = Math.round(deltaPx / pxPerMinute);
        const nextStart = clampTaskMoveStart(
          taskId,
          task.rowIndex,
          duration,
          initialStart + deltaMinutes,
          activeIntervalRanges,
          tasks,
        );
        setMovePreview({ taskId, minute: nextStart });
        updateTask(taskId, { startMinute: nextStart });
      };

      const onPointerUp = () => {
        setMovePreview(null);
        setDraggingTaskId(null);
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [tasks, updateTask, slotWidthPx, activeIntervalRanges, pushHistory],
  );

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  return (
    <div className={`flex min-h-0 flex-1 ${fullscreen ? 'gap-3' : 'gap-4'}`}>
      {/* 左：排班格線 */}
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950/40 ${
          fullscreen
            ? 'border border-zinc-800/80'
            : 'rounded-xl border border-zinc-800/80'
        }`}
      >
        <div
          className={`flex shrink-0 items-center gap-4 border-b border-zinc-800/60 ${
            fullscreen ? 'px-4 py-2' : 'px-3 py-2'
          }`}
        >
          {fullscreen && panelTitle ? (
            <h2 className="shrink-0 text-base font-medium text-zinc-100">{panelTitle}</h2>
          ) : null}
          <div className="min-w-0 flex-1">
            <PeriodLegend
              intervals={intervals}
              attributes={attributes}
              highlightedAttributeId={highlightedAttributeId}
            />
          </div>
          {fullscreen ? (
            <ScheduleTaskToolbar
              zoomValue={sliderFromSlotWidth(slotWidthPx)}
              viewMode={viewMode}
              fullscreen={fullscreen}
              canDeleteSelected={selectedTaskId != null}
              canUndo={canUndo}
              canRedo={canRedo}
              undoFlash={historyFlash === 'undo'}
              redoFlash={historyFlash === 'redo'}
              onDeleteSelected={deleteSelectedTask}
              onUndo={undo}
              onRedo={redo}
              onZoomChange={(value) => setSlotWidthPx(slotWidthFromSlider(value))}
              onViewModeChange={setViewMode}
              onFullscreenChange={onFullscreenChange}
              inline
              estimatedTripSeconds={estimatedTripSeconds}
              onEstimatedTripSecondsChange={setEstimatedTripSeconds}
            />
          ) : null}
        </div>
        {!fullscreen ? (
          <ScheduleTaskToolbar
            zoomValue={sliderFromSlotWidth(slotWidthPx)}
            viewMode={viewMode}
            fullscreen={fullscreen}
            canDeleteSelected={selectedTaskId != null}
            canUndo={canUndo}
            canRedo={canRedo}
            undoFlash={historyFlash === 'undo'}
            redoFlash={historyFlash === 'redo'}
            onDeleteSelected={deleteSelectedTask}
            onUndo={undo}
            onRedo={redo}
            onZoomChange={(value) => setSlotWidthPx(slotWidthFromSlider(value))}
            onViewModeChange={setViewMode}
            onFullscreenChange={onFullscreenChange}
            estimatedTripSeconds={estimatedTripSeconds}
            onEstimatedTripSecondsChange={setEstimatedTripSeconds}
          />
        ) : null}

        {/* Grid */}
        <div
          ref={gridRef}
          data-schedule-grid-scroll
          className="min-h-0 flex-1 overflow-auto"
        >
          <div
            className="relative min-w-max"
            style={{ width: totalTrackWidthPx + ROW_LABEL_WIDTH }}
          >
            {/* 時段直條高亮：每一份日拷貝各畫一次，往右平移一天 */}
            {dayCopies.map((copyIndex) => (
              <ScheduleIntervalColumnHighlight
                key={copyIndex}
                intervals={intervals}
                attributes={attributes}
                slotWidthPx={slotWidthPx}
                scheduleSlotMinutes={SCHEDULE_SLOT_MINUTES}
                trackWidthPx={trackWidthPx}
                rowLabelWidth={ROW_LABEL_WIDTH + copyIndex * dayWidthPx}
                selectedIntervalId={selectedIntervalId}
              />
            ))}

            {/* Time header + 車輛折返時限（與甘特圖同步捲動） */}
            <div className="relative sticky top-0 z-10 bg-[#0c0c0e]/95 backdrop-blur-sm">
              <div className="flex border-b border-zinc-800/80">
                <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-zinc-800/60 bg-[#0c0c0e]/95" />
                {dayCopies.map((copyIndex) => (
                <div key={copyIndex} className="relative flex shrink-0" style={{ width: trackWidthPx }}>
                  <div className="pointer-events-none absolute inset-0 z-0">
                    <ScheduleTimelineBackground
                      intervals={intervals}
                      attributes={attributes}
                      slotWidthPx={slotWidthPx}
                    />
                  </div>
                  {timeSlots.map((slot) => {
                    const slotActive = isColActive(slot, activeIntervalRanges);
                    return (
                      <div
                        key={slot}
                        className={`pointer-events-none relative z-[1] shrink-0 border-r border-zinc-800/40 py-2 pl-1 text-left text-[11px] tabular-nums ${
                          slotActive
                            ? SCHEDULE_TIME_AXIS_TEXT_CLASS
                            : `schedule-inactive-cell ${SCHEDULE_TIME_AXIS_TEXT_INACTIVE_CLASS}`
                        }`}
                        style={{ width: slotWidthPx }}
                      >
                        {formatSlotLabel(slot)}
                      </div>
                    );
                  })}
                  {/* 只在最後一份日拷貝的右端標 24:00——每份都標的話，
                      它會疊在下一份的 00:00 上，變成重複的雜訊 */}
                  {copyIndex === dayCopies.length - 1 ? (
                    <span
                      className={`pointer-events-none absolute top-2 z-[2] pl-0.5 text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
                      style={{ left: SCHEDULE_VISIBLE_SLOTS * slotWidthPx }}
                      aria-hidden
                    >
                      24:00
                    </span>
                  ) : null}
                  <ScheduleIntervalHeaderHits
                    intervals={intervals}
                    attributes={attributes}
                    slotWidthPx={slotWidthPx}
                    scheduleSlotMinutes={SCHEDULE_SLOT_MINUTES}
                    trackWidthPx={trackWidthPx}
                    rowLabelWidth={0}
                    selectedIntervalId={selectedIntervalId}
                    onSelectIntervalId={toggleIntervalSelection}
                    estimatedTripSeconds={estimatedTripSeconds}
                  />
                </div>
                ))}
              </div>

              <TurnaroundLimitGrid
                tasks={tasks}
                intervals={intervals}
                attributes={attributes}
                slotWidthPx={slotWidthPx}
                rowLabelWidth={ROW_LABEL_WIDTH}
                estimatedTripSeconds={estimatedTripSeconds}
                dayCopyCount={dayCopies.length}
              />
              {/* 表頭的時段直條高亮：跟格線那條一樣，每一份日拷貝都要畫 */}
              {dayCopies.map((copyIndex) => (
                <ScheduleIntervalHeaderColumnHighlight
                  key={copyIndex}
                  intervals={intervals}
                  attributes={attributes}
                  slotWidthPx={slotWidthPx}
                  scheduleSlotMinutes={SCHEDULE_SLOT_MINUTES}
                  trackWidthPx={trackWidthPx}
                  rowLabelWidth={ROW_LABEL_WIDTH + copyIndex * dayWidthPx}
                  selectedIntervalId={selectedIntervalId}
                />
              ))}
            </div>

            {/* Data rows */}
            {rows.map((row) => {
              const rowTasks = tasks.filter((t) => t.rowIndex === row);
              const rowHighlight =
                highlightedGap?.rowIndex === row ? highlightedGap : null;
              return (
                <div
                  key={row}
                  data-schedule-row={row}
                  className="relative flex border-b border-zinc-800/50"
                  onClick={() => setSelectedTaskId(null)}
                >
                  {/* Row label (sticky) */}
                  <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90 text-xs text-zinc-500">
                    {String(row).padStart(2, '0')}
                  </div>
                  {/* Grid cells (drop zones)：每一份日拷貝各畫一次 */}
                  {dayCopies.map((copyIndex) => (
                  <div key={copyIndex} className="relative flex shrink-0" style={{ width: trackWidthPx }}>
                    <div className="pointer-events-none absolute inset-0 z-0">
                      <ScheduleTimelineBackground
                        intervals={intervals}
                        attributes={attributes}
                        slotWidthPx={slotWidthPx}
                      />
                    </div>
                    {Array.from({ length: SCHEDULE_VISIBLE_SLOTS }, (_, col) => {
                      const slotActive = isColActive(col, activeIntervalRanges);
                      const isOver =
                        dragOverCell?.row === row && dragOverCell?.col === col;
                      return (
                        <div
                          key={col}
                          className={`relative z-[1] shrink-0 border-r border-zinc-800/30 transition-colors ${
                            isOver
                              ? 'bg-[rgba(43,127,255,0.25)]'
                              : slotActive
                                ? 'bg-transparent'
                                : 'schedule-inactive-cell'
                          } ${slotActive ? '' : 'cursor-not-allowed'}`}
                          style={{ width: slotWidthPx, height: ROW_HEIGHT_PX }}
                          onDragOver={(e) => handleDragOver(e, row, col)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, row, col)}
                        />
                      );
                    })}
                    {rowHighlight ? (
                      <div
                        className="pointer-events-none absolute inset-y-0.5 z-[3] rounded-md border border-amber-400/80 bg-amber-400/25 shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                        style={{
                          left: (rowHighlight.start / SCHEDULE_SLOT_MINUTES) * slotWidthPx,
                          width:
                            ((rowHighlight.end - rowHighlight.start) / SCHEDULE_SLOT_MINUTES)
                            * slotWidthPx,
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {/* Render task bars overlaid on top of grid cells */}
                    {rowTasks
                      .filter((task) =>
                        isWithinDayCycleWindow(viewWindow, copyIndex, [
                          {
                            start: task.startMinute,
                            end: task.startMinute + task.durationMinutes,
                          },
                        ]))
                      .map((task) => (
                      <TaskBar
                        key={`${task.id}#${copyIndex}`}
                        task={task}
                        selected={selectedTaskId === task.id}
                        slotWidthPx={slotWidthPx}
                        trackOffsetPx={ROW_LABEL_WIDTH + copyIndex * dayWidthPx}
                        activeIntervalRanges={activeIntervalRanges}
                        resizePreview={
                          resizePreview?.taskId === task.id ? resizePreview : null
                        }
                        movePreview={
                          movePreview?.taskId === task.id ? movePreview : null
                        }
                        isDragging={draggingTaskId === task.id}
                        onSelect={() => setSelectedTaskId(task.id)}
                        onDelete={() => deleteTask(task.id)}
                        onResize={(edge, e) => handleTaskResizeStart(task.id, edge, e)}
                        onMove={(e) => handleTaskMoveStart(task.id, e)}
                      />
                    ))}
                  </div>
                  ))}
                </div>
              );
            })}

            {/* Add row button */}
            <div className="flex border-b border-zinc-800/50">
              <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90">
                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex size-6 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
                  aria-label="新增列"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <div style={{ height: ROW_HEIGHT_PX }} />
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/60 px-3 py-2 text-xs text-zinc-500">
          <Info className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
          <span>
            {activeIntervalRanges.length === 0
              ? '請先在「營運時段」設定並確認時段後，才能於彩色區域放置任務'
              : '時軸可以左右滑動，查看更多任務'}
          </span>
          <span className="text-zinc-600">← →</span>
        </div>
      </div>

      {/* 右：任務面板 */}
      {viewMode === 'split' && (
      <aside className="flex w-[248px] shrink-0 flex-col gap-3">
        <SidebarCard
          icon={<Tag className="size-4 text-zinc-400" />}
          title="任務類型"
        >
          <div className="grid grid-cols-2 gap-2">
            {TASK_TYPE_OPTIONS.map((task) => (
              <TaskTypeChip
                key={task.key}
                taskKey={task.key}
                label={task.label}
              />
            ))}
          </div>
          <FillEmptySlotsControl
            disabled={activeIntervalRanges.length === 0}
            onConfirmFill={fillEmptySlots}
          />
          <ScheduleGapCheckButton
            gaps={scheduleGaps}
            onJump={jumpToNextScheduleGap}
          />
        </SidebarCard>

        <SidebarCard
          icon={<SlidersHorizontal className="size-4 text-zinc-400" />}
          title="任務設定"
          headerAction={
            selectedTask ? (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={!taskFormDirty}
                  onClick={() => taskSettingsFormRef.current?.reset()}
                  className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="取消任務設定變更"
                  title="取消變更"
                >
                  <X className="size-4" strokeWidth={2.5} />
                </button>
                <button
                  type="submit"
                  form={TASK_SETTINGS_FORM_ID}
                  disabled={!taskFormCanConfirm}
                  className="inline-flex size-7 items-center justify-center rounded-md text-[#51A2FF] transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500 disabled:opacity-40"
                  aria-label="確認任務設定"
                  title="確認變更"
                >
                  <Check className="size-4" strokeWidth={2.5} />
                </button>
              </div>
            ) : null
          }
        >
          {selectedTask ? (
            <TaskSettingsForm
              ref={taskSettingsFormRef}
              key={selectedTask.id}
              formId={TASK_SETTINGS_FORM_ID}
              task={selectedTask}
              tasks={tasks}
              activeIntervalRanges={activeIntervalRanges}
              rowCount={rowCount}
              onDirtyChange={setTaskFormDirty}
              onCanConfirmChange={setTaskFormCanConfirm}
              onConfirm={(updated) => {
                pushHistory();
                onTasksChange(updateScheduleTask(tasks, updated.id, updated));
              }}
            />
          ) : (
            <PanelNoData message="沒有選取" />
          )}
        </SidebarCard>
      </aside>
      )}
    </div>
  );
}
