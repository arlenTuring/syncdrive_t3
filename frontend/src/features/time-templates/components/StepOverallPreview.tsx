import { useMemo } from 'react';
import { Info } from 'lucide-react';
import {
  SCHEDULE_ROW_COUNT_INITIAL,
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_SLOT_WIDTH_DEFAULT,
  SCHEDULE_VISIBLE_SLOTS,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  TASK_TYPE_COLORS,
  buildAttributeIntervalLegends,
  formatMinutesToTime,
  resolveTimeTemplateDraftName,
  getInactiveRangesWithinBar,
  blendHexOnBase,
  parseIntervalMinuteRanges,
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';
import { PanelNoData } from './PanelNoData';
import { AttributeLegendBadgeChip } from './AttributeLegendBadgeChip';

const ROW_HEIGHT_PX = 36;
const ROW_LABEL_WIDTH = 48;

function formatSlotLabel(slotIndex: number): string {
  const totalMinutes = slotIndex * SCHEDULE_SLOT_MINUTES;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function ScheduleTimelineBackground({
  intervals,
  attributes,
  slotWidthPx,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
}) {
  const totalWidth = SCHEDULE_VISIBLE_SLOTS * slotWidthPx;

  return (
    <>
      <div
        className="schedule-inactive-timeline absolute inset-y-0 left-0"
        style={{ width: totalWidth }}
        aria-hidden
      />
      {intervals.map((slot) => {
        const start = parseIntervalStartMinutes(slot.startTime);
        const end = parseIntervalEndMinutes(slot.endTime);
        if (start == null || end == null || end <= start) return null;
        const attr = attributes.find((a) => a.id === slot.attributeId);
        const accent = attr?.color ?? '#7C86FF';
        const leftPx = (start / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
        const widthPx = ((end - start) / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
        return (
          <div
            key={slot.id}
            className="absolute inset-y-0 z-[1]"
            style={{
              left: leftPx,
              width: widthPx,
              backgroundColor: blendHexOnBase(accent, 0.38),
            }}
            title={`${slot.name} ${slot.startTime} - ${slot.endTime}`}
          />
        );
      })}
    </>
  );
}

function PreviewTaskBar({
  task,
  slotWidthPx,
  activeIntervalRanges,
}: {
  task: ScheduleTask;
  slotWidthPx: number;
  activeIntervalRanges: ReturnType<typeof parseIntervalMinuteRanges>;
}) {
  const colors = TASK_TYPE_COLORS[task.taskType];
  const widthPx = (task.durationMinutes / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
  const leftPx = (task.startMinute / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
  const endMinute = task.startMinute + task.durationMinutes;
  const timeLabel = `${formatMinutesToTime(task.startMinute)}-${formatMinutesToTime(endMinute)}`;
  const inactiveRanges = useMemo(
    () => getInactiveRangesWithinBar(task.startMinute, endMinute, activeIntervalRanges),
    [task.startMinute, endMinute, activeIntervalRanges],
  );

  return (
    <div
      className="pointer-events-none absolute top-[2px] isolate flex items-center overflow-hidden rounded-[4px]"
      style={{
        left: leftPx,
        width: widthPx,
        height: ROW_HEIGHT_PX - 4,
        backgroundColor: colors.bg,
        zIndex: 1,
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
      <div
        className="absolute inset-y-0 left-0 z-[2] w-1"
        style={{ backgroundColor: colors.bar }}
      />
      <div className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center px-1.5">
        <span
          className="max-w-full truncate text-center text-[10px] font-normal leading-[18px] tracking-[0.5px]"
          style={{ color: colors.text }}
        >
          {task.label}
          <span className="opacity-70"> | {timeLabel}</span>
        </span>
      </div>
    </div>
  );
}

type StepOverallPreviewProps = {
  name: string;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  tasks: ScheduleTask[];
  rowCount: number;
  emptyHint?: string;
  readOnly?: boolean;
};

export function StepOverallPreview({
  name,
  intervals,
  attributes,
  tasks,
  rowCount,
  emptyHint = '請於「任務排班」步驟放置任務後再預覽',
  readOnly = false,
}: StepOverallPreviewProps) {
  const slotWidthPx = SCHEDULE_SLOT_WIDTH_DEFAULT;
  const timeSlots = Array.from({ length: SCHEDULE_VISIBLE_SLOTS }, (_, i) => i);
  const rows = Array.from(
    { length: Math.max(SCHEDULE_ROW_COUNT_INITIAL, rowCount) },
    (_, i) => i + 1,
  );
  const activeIntervalRanges = useMemo(
    () => parseIntervalMinuteRanges(intervals),
    [intervals],
  );
  const legends = useMemo(
    () => buildAttributeIntervalLegends(intervals, attributes),
    [intervals, attributes],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* 模板名稱 + 營運時段圖例 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm text-zinc-500">模板名稱</span>
          <span className="truncate text-sm font-medium text-zinc-100">
            {resolveTimeTemplateDraftName(name)}
          </span>
        </div>
        {legends.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {legends.map((item) => (
              <AttributeLegendBadgeChip
                key={item.attributeId}
                item={item}
                className="inline-flex min-h-[26px] max-w-full items-center whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium"
              />
            ))}
          </div>
        )}
      </div>

      {/* 班表預覽格線 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40">
        {tasks.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6">
            <PanelNoData />
            <p className="text-xs text-zinc-600">{emptyHint}</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div
              className="min-w-max"
              style={{ width: SCHEDULE_VISIBLE_SLOTS * slotWidthPx + ROW_LABEL_WIDTH }}
            >
              {/* Time header */}
              <div className="sticky top-0 z-10 flex border-b border-zinc-800/80 bg-[#0c0c0e]/95 backdrop-blur-sm">
                <div className="sticky left-0 z-20 w-12 shrink-0 border-r border-zinc-800/60 bg-[#0c0c0e]/95" />
                <div className="relative flex">
                  <div className="pointer-events-none absolute inset-0 z-0">
                    <ScheduleTimelineBackground
                      intervals={intervals}
                      attributes={attributes}
                      slotWidthPx={slotWidthPx}
                    />
                  </div>
                  {timeSlots.map((slot) => (
                    <div
                      key={slot}
                      className={`relative z-[1] shrink-0 border-r border-zinc-800/40 py-2 pl-1 text-left text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
                      style={{ width: slotWidthPx }}
                    >
                      {formatSlotLabel(slot)}
                    </div>
                  ))}
                  <span
                    className={`pointer-events-none absolute top-2 z-[2] pl-0.5 text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
                    style={{ left: SCHEDULE_VISIBLE_SLOTS * slotWidthPx }}
                    aria-hidden
                  >
                    24:00
                  </span>
                </div>
              </div>

              {/* Data rows */}
              {rows.map((row) => {
                const rowTasks = tasks.filter((t) => t.rowIndex === row);
                return (
                  <div key={row} className="relative flex border-b border-zinc-800/50">
                    <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90 text-xs text-zinc-500">
                      {String(row).padStart(2, '0')}
                    </div>
                    <div className="relative flex">
                      <div className="pointer-events-none absolute inset-0 z-0">
                        <ScheduleTimelineBackground
                          intervals={intervals}
                          attributes={attributes}
                          slotWidthPx={slotWidthPx}
                        />
                      </div>
                      {timeSlots.map((col) => {
                        const slotStart = col * SCHEDULE_SLOT_MINUTES;
                        const slotEnd = slotStart + SCHEDULE_SLOT_MINUTES;
                        const slotActive = activeIntervalRanges.some(
                          (range) => range.start < slotEnd && range.end > slotStart,
                        );
                        return (
                          <div
                            key={col}
                            className={`relative z-[1] shrink-0 border-r border-zinc-800/30 ${
                              slotActive ? 'bg-transparent' : 'schedule-inactive-cell'
                            }`}
                            style={{ width: slotWidthPx, height: ROW_HEIGHT_PX }}
                          />
                        );
                      })}
                      {rowTasks.map((task) => (
                        <PreviewTaskBar
                          key={task.id}
                          task={task}
                          slotWidthPx={slotWidthPx}
                          activeIntervalRanges={activeIntervalRanges}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/60 px-3 py-2 text-xs text-zinc-500">
          <Info className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
          <span>{readOnly ? '僅供預覽，可左右滑動查看班表' : '時軸可以左右滑動，查看更多任務'}</span>
          <span className="text-zinc-600">← →</span>
        </div>
      </div>
    </div>
  );
}
