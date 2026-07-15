import { Info, AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import {
  SCHEDULE_SLOT_WIDTH_DEFAULT,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  SCHEDULE_ENGINE_TASK_TYPE_COLORS,
  getInactiveRangesWithinBar,
  hexToRgba,
  parseIntervalMinuteRanges,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../../time-templates/types/editor';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from '../utils/shiftScheduleEngine.types';
import type { ScheduleTask } from '../../time-templates/types/editor';

const ROW_HEIGHT_PX = 82;
const ROW_LABEL_WIDTH = 48;

// 班次卡大小高度調整參數
const TEMPLATE_TASK_BAR_HEIGHT = 26; // 頂部時間模板任務卡片高度
const REAL_TASK_BAR_HEIGHT = 52;     // 下層真實排班班次卡卡片高度
const REAL_TASK_BAR_TOP = 30;        // 下層真實排班班次卡卡片頂部位移

const GRID_SLOT_MINUTES = 10;
const GRID_VISIBLE_SLOTS = 144; // 24 hours * 6 slots/hour

function formatMinuteToHm(minute: number): string {
  const hh = Math.floor(minute / 60);
  const mm = Math.round(minute % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function TemplateTaskBar({
  task,
  slotWidthPx,
}: {
  task: ScheduleTask;
  slotWidthPx: number;
}) {
  const widthPx = (task.durationMinutes / GRID_SLOT_MINUTES) * slotWidthPx;
  const leftPx = (task.startMinute / GRID_SLOT_MINUTES) * slotWidthPx;
  const endMinute = task.startMinute + task.durationMinutes;
  const timeLabel = `${formatMinuteToHm(task.startMinute)}-${formatMinuteToHm(endMinute)}`;

  return (
    <div
      className="absolute top-[2px] z-[2] flex items-center justify-start rounded-[4px] border border-zinc-700/60 bg-zinc-800/80 px-2 overflow-hidden"
      style={{
        left: leftPx,
        width: widthPx,
        height: TEMPLATE_TASK_BAR_HEIGHT,
      }}
      title={`${task.label} ${timeLabel}`}
    >
      <span
        className="sticky left-[56px] shrink-0 max-w-full truncate text-[10px] font-normal leading-[18px] tracking-[0.5px] text-zinc-300"
      >
        {task.label}
        <span className="opacity-70"> | {timeLabel}</span>
      </span>
    </div>
  );
}

function formatSlotLabel(slotIndex: number): string {
  const totalMinutes = slotIndex * GRID_SLOT_MINUTES;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatMinuteToHms(minute: number): string {
  const totalSeconds = Math.max(0, Math.round(minute * 60));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatBlockTimeRange(block: GeneratedScheduleBlock): string {
  return `${formatMinuteToHms(block.plannedStartMinute)} - ${formatMinuteToHms(block.plannedEndMinute)}`;
}

function formatMinuteToHmCompact(minute: number): string {
  const hh = Math.floor(minute / 60);
  const mm = Math.floor(minute % 60);
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

function resolveBlockCode(block: GeneratedScheduleBlock, index: number): string {
  if (block.taskType === 'passenger') {
    const code = block.routeCode ?? (block.routeName?.includes('下行') ? 'D' : block.routeName?.includes('上行') ? 'U' : 'R');
    const timeStr = formatMinuteToHmCompact(block.plannedStartMinute);
    return `${code}${timeStr}`;
  }
  if (block.routeId) {
    const compact = block.routeId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (compact.length >= 4) return compact.slice(0, 5);
  }
  return `T${String(index + 1).padStart(4, '0')}`;
}

function ScheduleIntervalBackground({
  intervals,
  attributes,
  slotWidthPx,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
}) {
  const totalWidth = GRID_VISIBLE_SLOTS * slotWidthPx;
  return (
    <>
      <div
        className="schedule-inactive-timeline absolute inset-y-0 left-0"
        style={{ width: totalWidth }}
        aria-hidden
      />
      {intervals.map((slot) => {
        const start = parseIntervalMinuteRanges([slot])[0]?.start;
        const end = parseIntervalMinuteRanges([slot])[0]?.end;
        if (start == null || end == null || end <= start) return null;
        const attr = attributes.find((item) => item.id === slot.attributeId);
        const accent = attr?.color ?? '#7C86FF';
        const leftPx = (start / GRID_SLOT_MINUTES) * slotWidthPx;
        const widthPx = ((end - start) / GRID_SLOT_MINUTES) * slotWidthPx;
        return (
          <div
            key={slot.id}
            className="absolute inset-y-0 z-[1]"
            style={{
              left: leftPx,
              width: widthPx,
              backgroundColor: hexToRgba(accent, 0.28),
            }}
            title={`${slot.name} ${slot.startTime} - ${slot.endTime}`}
          />
        );
      })}
    </>
  );
}

function ShiftScheduleBlockBar({
  block,
  blockIndex,
  slotWidthPx,
  activeIntervalRanges,
  selected = false,
  onSelect,
  report = null,
  highlighted = false,
}: {
  block: GeneratedScheduleBlock;
  blockIndex: number;
  slotWidthPx: number;
  activeIntervalRanges: ReturnType<typeof parseIntervalMinuteRanges>;
  selected?: boolean;
  onSelect?: (blockId: string) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlighted?: boolean;
}) {
  const colors = SCHEDULE_ENGINE_TASK_TYPE_COLORS[block.taskType];
  const durationMinutes = block.plannedEndMinute - block.plannedStartMinute;
  const widthPx = (durationMinutes / GRID_SLOT_MINUTES) * slotWidthPx;
  const leftPx = (block.plannedStartMinute / GRID_SLOT_MINUTES) * slotWidthPx;
  const inactiveRanges = useMemo(
    () =>
      getInactiveRangesWithinBar(
        block.plannedStartMinute,
        block.plannedEndMinute,
        activeIntervalRanges,
      ),
    [activeIntervalRanges, block.plannedEndMinute, block.plannedStartMinute],
  );
  const isIdleLike = block.taskType === 'idle' || block.source === 'transition';
  const code = resolveBlockCode(block, blockIndex);
  const timeLabel = formatBlockTimeRange(block);
  const selectable = block.source === 'template_bar' && onSelect != null;

  const hasError = useMemo(() => {
    if (!report || !report.errors) return false;
    return report.errors.some((issue) => {
      const d = issue.detail;
      if (!d) return false;
      return (
        d.blockId === block.id ||
        d.nextBlockId === block.id ||
        d.templateTaskId === block.id ||
        d.templateTaskId === block.templateTaskId
      );
    });
  }, [report, block.id, block.templateTaskId]);

  const hasWarning = useMemo(() => {
    if (!report || !report.warnings) return false;
    return report.warnings.some((issue) => {
      const d = issue.detail;
      if (!d) return false;
      return (
        d.blockId === block.id ||
        d.nextBlockId === block.id ||
        d.templateTaskId === block.id ||
        d.templateTaskId === block.templateTaskId
      );
    });
  }, [report, block.id, block.templateTaskId]);

  let extraBorderClass = '';
  let extraStyle: React.CSSProperties = {};
  if (highlighted) {
    extraBorderClass = 'border-2 border-red-500 ring-4 ring-red-500 shadow-[0_0_24px_rgba(239,68,68,1)] animate-pulse';
  } else if (hasError) {
    extraBorderClass = 'border border-red-500 shadow-[inset_0_0_4px_rgba(239,68,68,0.4),0_0_8px_rgba(239,68,68,0.5)] animate-pulse';
  } else if (hasWarning) {
    extraBorderClass = 'border border-amber-500 shadow-[inset_0_0_4px_rgba(245,158,11,0.4),0_0_8px_rgba(245,158,11,0.5)]';
  }

  return (
    <div
      id={`block-card-${block.id}`}
      className={`absolute isolate flex flex-col justify-center overflow-hidden rounded-[4px] px-1 ${
        isIdleLike ? 'schedule-task-inactive-overlay pointer-events-none' : ''
      } ${
        selected ? 'ring-2 ring-[#2B7FFF] ring-offset-1 ring-offset-zinc-950' : ''
      } ${selectable ? 'cursor-pointer' : 'pointer-events-none'} ${extraBorderClass}`}
      style={{
        left: leftPx,
        width: Math.max(widthPx, 4),
        height: REAL_TASK_BAR_HEIGHT,
        top: REAL_TASK_BAR_TOP,
        backgroundColor: colors.bg,
        zIndex: highlighted ? 50 : (block.source === 'template_bar' ? 2 : 1),
        ...extraStyle,
      }}
      title={`${block.label} ${timeLabel}${hasError ? ' (有嚴重錯誤)' : ''}${hasWarning ? ' (有警告)' : ''}`}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? () => onSelect(block.id) : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(block.id);
              }
            }
          : undefined
      }
    >
      {!isIdleLike && (
        <div
          className="absolute inset-y-0 left-0 z-[2] w-1"
          style={{ backgroundColor: hasError ? '#EF4444' : hasWarning ? '#F59E0B' : colors.bar }}
          aria-hidden
        />
      )}
      {inactiveRanges.map((range) => {
        const leftPct =
          ((range.start - block.plannedStartMinute) / durationMinutes) * 100;
        const widthPct = ((range.end - range.start) / durationMinutes) * 100;
        return (
          <div
            key={`${range.start}-${range.end}`}
            className="schedule-task-inactive-overlay pointer-events-none absolute inset-y-0 z-[4]"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            aria-hidden
          />
        );
      })}
      <div className="sticky left-[56px] z-[6] min-w-0 max-w-full px-1">
        <div
          className="flex items-center gap-1 truncate text-xs font-semibold leading-tight"
          style={{ color: hasError ? '#FCA5A5' : hasWarning ? '#FDE68A' : colors.text }}
        >
          {hasError && <AlertTriangle className="size-3 text-red-400 shrink-0" />}
          {hasWarning && !hasError && <AlertTriangle className="size-3 text-amber-400 shrink-0" />}
          <span className="truncate">{code}</span>
        </div>
        {block.routeName ? (
          <div className="flex min-w-0 items-center gap-0.5 truncate text-[11px] leading-tight text-zinc-200/90 font-medium">
            <span className="truncate">{block.routeName}</span>
            <Info className="size-2.5 shrink-0 opacity-70" aria-hidden />
          </div>
        ) : (
          <div
            className="truncate text-[11px] leading-tight opacity-90 font-medium"
            style={{ color: colors.text }}
          >
            {block.label}
          </div>
        )}
        <div className="truncate text-[10px] tabular-nums leading-tight text-zinc-300 font-medium">
          {timeLabel}
        </div>
      </div>
    </div>
  );
}

export type ShiftSchedulePlanGridProps = {
  plan: GeneratedSchedulePlan;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  templateTasks: ScheduleTask[];
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlightedBlockId?: string | null;
};

export function ShiftSchedulePlanGrid({
  plan,
  intervals,
  attributes,
  templateTasks,
  selectedBlockId = null,
  onSelectBlock,
  report = null,
  highlightedBlockId = null,
}: ShiftSchedulePlanGridProps) {
  const slotWidthPx = Math.round(SCHEDULE_SLOT_WIDTH_DEFAULT * 1.5);
  const activeIntervalRanges = useMemo(
    () => parseIntervalMinuteRanges(intervals.filter((slot) => !slot.isDraft)),
    [intervals],
  );
  const timeSlots = Array.from({ length: GRID_VISIBLE_SLOTS }, (_, index) => index);
  const rows = Array.from({ length: plan.scheduleRowCount }, (_, index) => index + 1);
  const blocksByRow = useMemo(() => {
    const map = new Map<number, GeneratedScheduleBlock[]>();
    for (const timeline of plan.timelines) {
      map.set(
        timeline.row,
        [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute),
      );
    }
    return map;
  }, [plan.timelines]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="min-w-max"
          style={{ width: GRID_VISIBLE_SLOTS * slotWidthPx + ROW_LABEL_WIDTH }}
        >
          <div className="sticky top-0 z-10 bg-[#0c0c0e]/95 backdrop-blur-sm">
            <div className="flex border-b border-zinc-800/80">
              <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-zinc-800/60 bg-[#0c0c0e]/95" />
              <div className="relative flex">
                <ScheduleIntervalBackground
                  intervals={intervals.filter((slot) => !slot.isDraft)}
                  attributes={attributes}
                  slotWidthPx={slotWidthPx}
                />
                {timeSlots.map((slot) => (
                  <div
                    key={slot}
                    className={`relative z-[1] shrink-0 border-r border-zinc-800/40 py-2 pl-1 text-left text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
                    style={{ width: slotWidthPx }}
                  >
                    {formatSlotLabel(slot)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {rows.map((row) => {
            const rowBlocks = blocksByRow.get(row) ?? [];
            const rowTemplateTasks = templateTasks.filter((t) => t.rowIndex === row);
            return (
              <div key={row} className="relative flex border-b border-zinc-800/50">
                <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90 text-xs text-zinc-500">
                  {String(row).padStart(2, '0')}
                </div>
                <div className="relative flex" style={{ width: GRID_VISIBLE_SLOTS * slotWidthPx }}>
                  <div className="pointer-events-none absolute inset-0 z-0">
                    <ScheduleIntervalBackground
                      intervals={intervals.filter((slot) => !slot.isDraft)}
                      attributes={attributes}
                      slotWidthPx={slotWidthPx}
                    />
                  </div>
                  {/* Top Lane: Time template original tasks */}
                  {rowTemplateTasks.map((task) => (
                    <TemplateTaskBar
                      key={task.id}
                      task={task}
                      slotWidthPx={slotWidthPx}
                    />
                  ))}
                  {/* Bottom Lane: Scheduled departures & tasks */}
                  {rowBlocks
                    .filter((block) => block.source !== 'transition')
                    .map((block, index) => (
                      <ShiftScheduleBlockBar
                        key={block.id}
                        block={block}
                        blockIndex={index}
                        slotWidthPx={slotWidthPx}
                        activeIntervalRanges={activeIntervalRanges}
                        selected={selectedBlockId === block.id}
                        onSelect={onSelectBlock}
                        report={report}
                        highlighted={highlightedBlockId === block.id}
                      />
                    ))}
                  <div style={{ width: slotWidthPx, height: ROW_HEIGHT_PX }} aria-hidden />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/60 px-3 py-2 text-xs text-zinc-500">
        <Info className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
        <span>
          {onSelectBlock
            ? '點選任務區塊可調整計畫發車時刻（10 秒刻度）；時軸可左右滑動'
            : '時軸可以左右滑動，查看更多任務'}
        </span>
        <span className="text-zinc-600">← →</span>
      </div>
    </div>
  );
}
