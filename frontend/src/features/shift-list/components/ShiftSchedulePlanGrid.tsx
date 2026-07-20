import { Info, AlertTriangle, Trash2, CopyPlus } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  SCHEDULE_SLOT_WIDTH_DEFAULT,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  SCHEDULE_ENGINE_TASK_TYPE_COLORS,
  blendHexOnBase,
  formatSelectedIntervalHoverContent,
  getInactiveRangesWithinBar,
  parseIntervalMinuteRanges,
  type TimeSlotAttribute,
  type TimeSlotInterval,
  type TaskTypeKey,
} from '../../time-templates/types/editor';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ShiftScheduleFeasibilityReport,
} from '../utils/shiftScheduleEngine.types';
import type { ScheduleTask } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeSwitchBufferAfterSeconds,
  sumStationDwellSecondsWithSlack,
} from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
  type BlockStationStopTime,
} from '../utils/buildBlockStationDepartures';
import { resolveEffectiveRouteTravelSeconds } from '../utils/stationLegTravel';
import {
  buildScheduleBlockTripCode,
  resolveMaintenanceSectionCodeForTaskType,
  type MaintenanceSectionCodeBySection,
} from '../utils/maintenanceSectionCode';
import { minuteFromClientX, resolveManualBlockMinDurationMinutes } from '../utils/manualScheduleEdit';
import { MANUAL_BLOCK_MIN_DURATION_SECONDS } from '../utils/buildManualShiftScheduleOutput';

const ROW_HEIGHT_PX = 82;
const ROW_LABEL_WIDTH = 48;

// 班次卡大小高度調整參數
const TEMPLATE_TASK_BAR_HEIGHT = 26; // 頂部時間模板任務卡片高度
const REAL_TASK_BAR_HEIGHT = 52;     // 下層真實排班班次卡卡片高度
const REAL_TASK_BAR_TOP = 30;        // 下層真實排班班次卡卡片頂部位移
const EDGE_HANDLE_PX = 8;
const MANUAL_MIN_DURATION_MINUTES = MANUAL_BLOCK_MIN_DURATION_SECONDS / 60;

const GRID_SLOT_MINUTES = 10;
const GRID_VISIBLE_SLOTS = 144; // 24 hours * 6 slots/hour

type HoverCardPos = {
  top: number;
  left: number;
};

/** 頂部時間軸 hover 卡片（與建立時間模板相同內容格式） */
function IntervalAxisHoverCard({
  interval,
  attribute,
  pos,
}: {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  pos: HoverCardPos;
}) {
  const content = formatSelectedIntervalHoverContent(interval, attribute);
  const accent = attribute?.color ?? '#7C86FF';

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-3 py-2.5 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <span className="text-[11px] font-semibold leading-4 text-zinc-100">
          {content.title}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-[10px] leading-[15px] text-zinc-300">
        {content.lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-700/90"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

/** 班次卡算法對照：頂部一行摘要 + 站↔站時間軸 */
function BlockAlgorithmHoverCard({
  routeName,
  summary,
  stops,
  legs,
  pos,
}: {
  routeName: string;
  summary: {
    topologyMinSeconds: number | null;
    topologyAvgSeconds: number | null;
    actualTravelSeconds: number;
    dwellEffectiveSeconds: number;
    dwellSlackSeconds: number;
    switchBufferSeconds: number;
    recoverySeconds: number;
  };
  stops: BlockStationStopTime[];
  legs: ShiftScheduleStationLegTravel[];
  pos: HoverCardPos;
}) {
  const sec = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}s`;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-[300px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="truncate text-[11px] font-semibold leading-4 text-zinc-100">
        {routeName}
      </div>
      <p className="mt-1 text-[10px] leading-[14px] tabular-nums text-zinc-400">
        行駛 {sec(summary.actualTravelSeconds)}
        <span className="text-zinc-600">（均 {sec(summary.topologyAvgSeconds)} · 快 {sec(summary.topologyMinSeconds)}）</span>
        <span className="text-zinc-600"> · </span>
        靠站 {sec(summary.dwellEffectiveSeconds)}
        {summary.dwellSlackSeconds > 0 ? (
          <span className="text-zinc-600">（+{sec(summary.dwellSlackSeconds)}/站）</span>
        ) : null}
        <span className="text-zinc-600"> · </span>
        換線 {sec(summary.switchBufferSeconds)}
        <span className="text-zinc-600"> · </span>
        恢復 {sec(summary.recoverySeconds)}
      </p>

      {stops.length === 0 ? (
        <p className="mt-2 text-[10px] text-zinc-500">尚無站點資料</p>
      ) : (
        <ol className="mt-2 max-h-[260px] space-y-0 overflow-y-auto text-[10px] leading-[14px]">
          {stops.map((stop, index) => {
            const leg = legs[index];
            const actualLeg = stop.travelToNextSeconds;
            const showLeg = index < stops.length - 1;
            return (
              <li key={`${stop.order}-${stop.stationId}`} className="min-w-0">
                <div className="flex items-baseline gap-1.5 text-zinc-300">
                  <span className="w-3 shrink-0 tabular-nums text-zinc-500">{stop.order}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
                    {stop.stationName}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-400">
                    {formatMinuteToHms(stop.arrivalMinute)}
                    <span className="text-zinc-600">→</span>
                    {formatMinuteToHms(stop.departureMinute)}
                  </span>
                  <span className="w-9 shrink-0 text-right tabular-nums text-zinc-500">
                    {sec(stop.dwellSeconds)}
                  </span>
                </div>
                {showLeg ? (
                  <div className="ml-3 flex items-center gap-1.5 border-l border-zinc-800 py-1 pl-2.5 text-[10px] tabular-nums text-zinc-500">
                    <span className="text-zinc-600">↓</span>
                    <span>
                      快 {sec(leg?.minTravelTimeSeconds)}
                      <span className="text-zinc-600"> · </span>
                      均 {sec(leg?.avgTravelTimeSeconds)}
                      {actualLeg != null ? (
                        <>
                          <span className="text-zinc-600"> · </span>
                          本班 {sec(actualLeg)}
                        </>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-700/90"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

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

  const isSticky = task.durationMinutes >= 20;

  return (
    <div
      className="pointer-events-none absolute top-[2px] z-[2] flex items-center justify-start overflow-clip rounded-[4px] border border-zinc-700/60 bg-zinc-800/80 px-2"
      style={{
        left: leftPx,
        width: widthPx,
        height: TEMPLATE_TASK_BAR_HEIGHT,
      }}
      title={`${task.label} ${timeLabel}`}
      aria-hidden
    >
      <span
        className={`${
          isSticky ? 'sticky left-[56px]' : ''
        } shrink-0 max-w-full truncate text-[10px] font-normal leading-[18px] tracking-[0.5px] text-zinc-300`}
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

function resolveBlockCode(
  block: GeneratedScheduleBlock,
  index: number,
  sectionCodes?: MaintenanceSectionCodeBySection | null,
): string {
  if (block.taskType === 'passenger') {
    return buildScheduleBlockTripCode({
      prefixCode: block.routeCode,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
      includeColumnCode: false,
    });
  }

  if (block.taskType !== 'idle') {
    const sectionCode = resolveMaintenanceSectionCodeForTaskType(
      block.taskType,
      sectionCodes,
    );
    return buildScheduleBlockTripCode({
      prefixCode: sectionCode,
      timelineRow: block.timelineRow,
      startMinute: block.plannedStartMinute,
    });
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
  interactive = false,
}: {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
  /** 頂部時間軸：可 hover 顯示時段屬性／班距 */
  interactive?: boolean;
}) {
  const totalWidth = GRID_VISIBLE_SLOTS * slotWidthPx;
  return (
    <>
      <div
        className="schedule-inactive-timeline pointer-events-none absolute inset-y-0 left-0"
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
        if (interactive) {
          return (
            <ScheduleIntervalAxisHit
              key={slot.id}
              interval={slot}
              attribute={attr}
              leftPx={leftPx}
              widthPx={widthPx}
              accent={accent}
            />
          );
        }
        return (
          <div
            key={slot.id}
            className="pointer-events-none absolute inset-y-0 z-[1]"
            style={{
              left: leftPx,
              width: widthPx,
              // 不透明混色，完全蓋住底層斜線；僅無時段屬性區保留黑色斜紋
              backgroundColor: blendHexOnBase(accent, 0.38),
            }}
            aria-hidden
          />
        );
      })}
    </>
  );
}

function ScheduleIntervalAxisHit({
  interval,
  attribute,
  leftPx,
  widthPx,
  accent,
}: {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  leftPx: number;
  widthPx: number;
  accent: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<HoverCardPos | null>(null);

  const showAt = (clientX: number, clientY: number) => {
    setPos({
      top: Math.max(clientY - 12, 64),
      left: Math.min(Math.max(clientX, 120), window.innerWidth - 120),
    });
  };

  return (
    <>
      {/* 色帶在時間刻度之下，避免蓋住軸文字 */}
      <div
        className="pointer-events-none absolute inset-y-0 z-[1]"
        style={{
          left: leftPx,
          width: widthPx,
          backgroundColor: blendHexOnBase(accent, 0.38),
        }}
        aria-hidden
      />
      <button
        ref={anchorRef}
        type="button"
        className="absolute inset-y-0 z-[5] cursor-help border-0 bg-transparent p-0"
        style={{
          left: leftPx,
          width: widthPx,
        }}
        aria-label={`${interval.name} ${interval.startTime} — ${interval.endTime}`}
        onMouseEnter={(event) => {
          setHovered(true);
          showAt(event.clientX, event.clientY);
        }}
        onMouseMove={(event) => {
          if (!hovered) setHovered(true);
          showAt(event.clientX, event.clientY);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setPos(null);
        }}
        onFocus={() => {
          const el = anchorRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          setHovered(true);
          showAt(rect.left + Math.min(rect.width, 200) / 2, rect.top);
        }}
        onBlur={() => {
          setHovered(false);
          setPos(null);
        }}
      />
      {hovered && pos ? (
        <IntervalAxisHoverCard
          interval={interval}
          attribute={attribute}
          pos={pos}
        />
      ) : null}
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
  selectedRoutes = [],
  minimumRecoveryTimeSeconds = null,
  sectionCodes = null,
  interactiveEdit = false,
  onCommitTimeRange,
  onPreviewTimeRange,
  onDeleteBlock,
  onDuplicateBlock,
}: {
  block: GeneratedScheduleBlock;
  blockIndex: number;
  slotWidthPx: number;
  activeIntervalRanges: ReturnType<typeof parseIntervalMinuteRanges>;
  selected?: boolean;
  onSelect?: (blockId: string | null) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlighted?: boolean;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds?: number | null;
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  interactiveEdit?: boolean;
  onCommitTimeRange?: (blockId: string, startMinute: number, endMinute: number) => void;
  onPreviewTimeRange?: (blockId: string, startMinute: number, endMinute: number) => void;
  onDeleteBlock?: (blockId: string) => void;
  onDuplicateBlock?: (blockId: string) => void;
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
  const code = resolveBlockCode(block, blockIndex, sectionCodes);
  const timeLabel = formatBlockTimeRange(block);
  const selectable = block.source === 'template_bar' && onSelect != null;
  const isStickyLabel = durationMinutes >= 20;
  const [stationHoverPos, setStationHoverPos] = useState<HoverCardPos | null>(null);

  const route = useMemo(
    () => resolveRouteForBlock(block, selectedRoutes),
    [block, selectedRoutes],
  );

  const stationStops = useMemo(() => {
    if (block.taskType !== 'passenger') return [];
    return buildBlockStationDepartures(block, route);
  }, [block, route]);

  const algorithmSummary = useMemo(() => {
    const travel = route ? resolveEffectiveRouteTravelSeconds(route) : null;
    const dwellSlackSeconds = normalizeDwellSlackSeconds(route?.dwellSlackSeconds);
    const dwellEffective =
      route != null
        ? sumStationDwellSecondsWithSlack(route.stationDwells, dwellSlackSeconds)
        : null;
    return {
      topologyMinSeconds: travel?.minTravelTimeSeconds ?? route?.minTravelTimeSeconds ?? null,
      topologyAvgSeconds: travel?.avgTravelTimeSeconds ?? route?.avgTravelTimeSeconds ?? null,
      actualTravelSeconds: block.travelSeconds,
      dwellEffectiveSeconds: dwellEffective ?? block.dwellSeconds,
      dwellSlackSeconds,
      switchBufferSeconds: normalizeSwitchBufferAfterSeconds(route?.switchBufferAfterSeconds),
      recoverySeconds: normalizeMinimumRecoveryTimeSeconds(minimumRecoveryTimeSeconds),
    };
  }, [block.dwellSeconds, block.travelSeconds, minimumRecoveryTimeSeconds, route]);

  const topologyLegs = useMemo(
    () => route?.stationLegTravels ?? [],
    [route?.stationLegTravels],
  );

  const showStationInfo = Boolean(block.routeName) && block.taskType === 'passenger';

  const hasError = useMemo(() => {
    if (!report || !report.errors) return false;
    return report.errors.some((issue) => {
      const d = issue.detail;
      if (!d) return false;
      return (
        d.blockId === block.id
        || d.nextBlockId === block.id
        || d.earlierBlockId === block.id
        || d.laterBlockId === block.id
        || d.templateTaskId === block.id
        || d.templateTaskId === block.templateTaskId
      );
    });
  }, [report, block.id, block.templateTaskId]);

  const hasWarning = useMemo(() => {
    if (!report || !report.warnings) return false;
    return report.warnings.some((issue) => {
      const d = issue.detail;
      if (!d) return false;
      return (
        d.blockId === block.id
        || d.nextBlockId === block.id
        || d.earlierBlockId === block.id
        || d.laterBlockId === block.id
        || d.templateTaskId === block.id
        || d.templateTaskId === block.templateTaskId
      );
    });
  }, [report, block.id, block.templateTaskId]);

  let extraBorderClass = '';
  let extraStyle: CSSProperties = {};
  if (highlighted) {
    extraBorderClass = 'border-2 border-red-500 ring-4 ring-red-500 shadow-[0_0_24px_rgba(239,68,68,1)] animate-pulse';
  } else if (hasError) {
    extraBorderClass = 'border border-red-500 shadow-[inset_0_0_4px_rgba(239,68,68,0.4),0_0_8px_rgba(239,68,68,0.5)] animate-pulse';
  } else if (hasWarning) {
    extraBorderClass = 'border border-amber-500 shadow-[inset_0_0_4px_rgba(245,158,11,0.4),0_0_8px_rgba(245,158,11,0.5)]';
  }

  const onStationInfoEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setStationHoverPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  };

  const beginInteractiveDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: 'move' | 'resize-start' | 'resize-end',
  ) => {
    if (!interactiveEdit || block.source !== 'template_bar') return;
    if (!onCommitTimeRange && !onPreviewTimeRange) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(block.id);

    const track = event.currentTarget.closest('[data-schedule-track="true"]') as HTMLElement | null;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const originStart = block.plannedStartMinute;
    const originEnd = block.plannedEndMinute;
    const originDuration = originEnd - originStart;
    const minDurationMinutes = Math.max(
      MANUAL_MIN_DURATION_MINUTES,
      resolveManualBlockMinDurationMinutes(block),
    );
    const pointerOriginMinute = minuteFromClientX({
      clientX: event.clientX,
      trackLeft: trackRect.left,
      slotWidthPx,
      slotMinutes: GRID_SLOT_MINUTES,
    });
    let lastStart = originStart;
    let lastEnd = originEnd;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    const applyPreview = (start: number, end: number) => {
      lastStart = start;
      lastEnd = end;
      onPreviewTimeRange?.(block.id, start, end);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const pointerMinute = minuteFromClientX({
        clientX: moveEvent.clientX,
        trackLeft: trackRect.left,
        slotWidthPx,
        slotMinutes: GRID_SLOT_MINUTES,
      });
      const delta = pointerMinute - pointerOriginMinute;
      if (mode === 'move') {
        const nextStart = Math.max(0, originStart + delta);
        applyPreview(nextStart, nextStart + originDuration);
        return;
      }
      if (mode === 'resize-start') {
        applyPreview(
          Math.min(originEnd - minDurationMinutes, Math.max(0, originStart + delta)),
          originEnd,
        );
        return;
      }
      applyPreview(
        originStart,
        Math.max(originStart + minDurationMinutes, originEnd + delta),
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try {
        target.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
      if (lastStart !== originStart || lastEnd !== originEnd) {
        onCommitTimeRange?.(block.id, lastStart, lastEnd);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      id={`block-card-${block.id}`}
      className={`absolute isolate flex flex-col justify-center overflow-hidden rounded-[4px] px-1 ${
        isIdleLike ? 'schedule-task-inactive-overlay pointer-events-none' : ''
      } ${
        selected ? 'ring-2 ring-[#2B7FFF] ring-offset-1 ring-offset-zinc-950' : ''
      } ${selectable ? (interactiveEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : 'pointer-events-none'} ${extraBorderClass}`}
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
      onClick={
        selectable
          ? (event) => {
              event.stopPropagation();
              onSelect?.(block.id);
            }
          : undefined
      }
      onPointerDown={
        selectable && interactiveEdit
          ? (event) => beginInteractiveDrag(event, 'move')
          : undefined
      }
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(block.id);
              }
            }
          : undefined
      }
    >
      {interactiveEdit && selectable ? (
        <>
          <div
            className="absolute inset-y-0 left-0 z-[9] cursor-ew-resize"
            style={{ width: EDGE_HANDLE_PX }}
            onPointerDown={(event) => beginInteractiveDrag(event, 'resize-start')}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 right-0 z-[9] cursor-ew-resize"
            style={{ width: EDGE_HANDLE_PX }}
            onPointerDown={(event) => beginInteractiveDrag(event, 'resize-end')}
            aria-hidden
          />
          {(onDeleteBlock || onDuplicateBlock) ? (
            <div
              className="absolute top-0.5 z-[10] flex items-center gap-0.5"
              style={{ right: EDGE_HANDLE_PX + 14 }}
            >
              {onDeleteBlock ? (
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded text-zinc-300/80 transition hover:bg-black/25 hover:text-red-300"
                  title="刪除班次卡"
                  aria-label="刪除班次卡"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteBlock(block.id);
                  }}
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              ) : null}
              {onDuplicateBlock ? (
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded text-zinc-300/80 transition hover:bg-black/25 hover:text-sky-300"
                  title="增生班次卡"
                  aria-label="增生班次卡"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDuplicateBlock(block.id);
                  }}
                >
                  <CopyPlus className="size-3" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
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
      <div className={isStickyLabel ? "sticky left-[56px] z-[6] min-w-0 max-w-full px-1" : "relative z-[6] min-w-0 px-1"}>
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
            {showStationInfo ? (
              <button
                type="button"
                className="pointer-events-auto relative z-[8] inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-zinc-300 opacity-80 hover:bg-white/10 hover:opacity-100"
                aria-label={`${block.routeName} 算法參數與站點時刻`}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={onStationInfoEnter}
                onPointerLeave={() => setStationHoverPos(null)}
              >
                <Info className="size-2.5" aria-hidden />
              </button>
            ) : (
              <Info className="size-2.5 shrink-0 opacity-70" aria-hidden />
            )}
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
      {stationHoverPos && showStationInfo ? (
        <BlockAlgorithmHoverCard
          routeName={block.routeName ?? block.label}
          summary={algorithmSummary}
          stops={stationStops}
          legs={topologyLegs}
          pos={stationHoverPos}
        />
      ) : null}
    </div>
  );
}

export type ShiftSchedulePlanGridProps = {
  plan: GeneratedSchedulePlan;
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  templateTasks: ScheduleTask[];
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string | null) => void;
  report?: ShiftScheduleFeasibilityReport | null;
  highlightedBlockId?: string | null;
  selectedRoutes?: ShiftScheduleSelectedRoute[];
  /** Step 4 最低恢復時間；供班次卡 i 對照顯示 */
  minimumRecoveryTimeSeconds?: number | null;
  /** Step 2 整備區塊代號；非正線班次代號用 */
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  /** 手動製作：隱藏時間模板任務列（僅留空白時間軸） */
  showTemplateTasks?: boolean;
  /** 手動製作：允許拖放／拖曳／縮放班次卡 */
  interactiveEdit?: boolean;
  onDropTaskType?: (timelineRow: number, startMinute: number, taskType: TaskTypeKey) => void;
  onCommitBlockTimeRange?: (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => void;
  /** 拖曳中即時預覽（不寫入 Undo 歷史） */
  onPreviewBlockTimeRange?: (
    blockId: string,
    startMinute: number,
    endMinute: number,
  ) => void;
  onDeleteBlock?: (blockId: string) => void;
  onDuplicateBlock?: (blockId: string) => void;
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
  selectedRoutes = [],
  minimumRecoveryTimeSeconds = null,
  sectionCodes = null,
  showTemplateTasks = true,
  interactiveEdit = false,
  onDropTaskType,
  onCommitBlockTimeRange,
  onPreviewBlockTimeRange,
  onDeleteBlock,
  onDuplicateBlock,
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
              <div className="relative flex" style={{ width: GRID_VISIBLE_SLOTS * slotWidthPx }}>
                <ScheduleIntervalBackground
                  intervals={intervals.filter((slot) => !slot.isDraft)}
                  attributes={attributes}
                  slotWidthPx={slotWidthPx}
                  interactive
                />
                {timeSlots.map((slot) => (
                  <div
                    key={slot}
                    className={`pointer-events-none relative z-[6] shrink-0 border-r border-zinc-800/40 py-2 pl-1 text-left text-[11px] tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS}`}
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
            const rowTemplateTasks = showTemplateTasks
              ? templateTasks.filter((t) => t.rowIndex === row)
              : [];
            const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
              if (!interactiveEdit || !onDropTaskType) return;
              if (!event.dataTransfer.types.includes('application/x-shift-block-type')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            };
            const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
              if (!interactiveEdit || !onDropTaskType) return;
              event.preventDefault();
              const taskType = event.dataTransfer.getData(
                'application/x-shift-block-type',
              ) as TaskTypeKey;
              if (!taskType) return;
              const trackRect = event.currentTarget.getBoundingClientRect();
              const startMinute = minuteFromClientX({
                clientX: event.clientX,
                trackLeft: trackRect.left,
                slotWidthPx,
                slotMinutes: GRID_SLOT_MINUTES,
              });
              onDropTaskType(row, startMinute, taskType);
            };
            return (
              <div key={row} className="relative flex border-b border-zinc-800/50">
                <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-center border-r border-zinc-800/60 bg-zinc-950/90 text-xs text-zinc-500">
                  {String(row).padStart(2, '0')}
                </div>
                <div
                  className="relative flex"
                  style={{ width: GRID_VISIBLE_SLOTS * slotWidthPx }}
                  data-schedule-track="true"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => {
                    if (onSelectBlock && selectedBlockId) {
                      onSelectBlock(null);
                    }
                  }}
                >
                  <div className="pointer-events-none absolute inset-0 z-0">
                    <ScheduleIntervalBackground
                      intervals={intervals.filter((slot) => !slot.isDraft)}
                      attributes={attributes}
                      slotWidthPx={slotWidthPx}
                    />
                  </div>
                  {rowTemplateTasks.map((task) => (
                    <TemplateTaskBar
                      key={task.id}
                      task={task}
                      slotWidthPx={slotWidthPx}
                    />
                  ))}
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
                        selectedRoutes={selectedRoutes}
                        minimumRecoveryTimeSeconds={minimumRecoveryTimeSeconds}
                        sectionCodes={sectionCodes}
                        interactiveEdit={interactiveEdit}
                        onCommitTimeRange={onCommitBlockTimeRange}
                        onPreviewTimeRange={onPreviewBlockTimeRange}
                        onDeleteBlock={onDeleteBlock}
                        onDuplicateBlock={onDuplicateBlock}
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
          {interactiveEdit
            ? '上方為時間模板任務（對照用）；下方班次卡可拖曳／左右縮放（10 秒格），不可重疊。點空白處可取消選取。'
            : onSelectBlock
              ? '滑鼠移到上方時間軸可看時段屬性；移到班次卡 i 可對照站間拓撲與靠站／緩衝；點選任務區塊可調整計畫發車時刻（10 秒刻度）；點空白處可取消選取'
              : '滑鼠移到上方時間軸可看時段屬性；移到班次卡 i 可對照站間拓撲與靠站／緩衝；時軸可以左右滑動'}
        </span>
        <span className="text-zinc-600">← →</span>
      </div>
    </div>
  );
}
