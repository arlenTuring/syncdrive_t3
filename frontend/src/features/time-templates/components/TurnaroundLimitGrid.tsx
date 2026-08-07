import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb } from 'lucide-react';
import {
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_VISIBLE_SLOTS,
  SCHEDULE_TIME_AXIS_TEXT_CLASS,
  SCHEDULE_TIME_AXIS_TEXT_INACTIVE_CLASS,
  type ScheduleTask,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';
import {
  computeTurnaroundLimitSegments,
  type TurnaroundLimitSegment,
} from '../utils/turnaroundLimitSegments';
import { recommendFleetRowCount } from '../utils/recommendFleetRowCount';
import { ScheduleTimelineBackground } from './scheduleTimelineBackground';

export const TURNAROUND_LIMIT_ROW_HEIGHT_PX = 30;

const TURNAROUND_LIMIT_ROW_TITLE = '正線建議';
const TURNAROUND_LIMIT_ROW_HINT =
  '建議車輛＝ceil(完整交路週期÷班距)。週期請填一整輪（非單線）；短時段常需再加列。';

type TurnaroundLimitGridProps = {
  tasks: ScheduleTask[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
  rowLabelWidth: number;
  estimatedTripSeconds?: number | null;
};

/** 將「自 00:00 起的分鐘」格式化為 HH:MM:SS（整分對應 :00） */
function formatMinuteAsHms(totalMinutes: number): string {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

type HoverCardPos = {
  clientX: number;
  clientY: number;
};

type PlacedHoverCard = {
  top: number;
  left: number;
  maxHeight: number;
};

function TurnaroundLimitHoverCard({
  segment,
  pos,
  estimatedTripSeconds,
}: {
  segment: TurnaroundLimitSegment;
  pos: HoverCardPos;
  estimatedTripSeconds?: number | null;
}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedHoverCard | null>(null);
  const existingVehicles = segment.activePassengerCount;
  const intervalDurationSeconds =
    (segment.endMinute - segment.startMinute) * 60;
  const fleet = recommendFleetRowCount({
    cycleSeconds: estimatedTripSeconds ?? 0,
    headwaySeconds: segment.headwaySeconds ?? 0,
    intervalDurationSeconds,
  });
  const recommendedVehicles = fleet?.recommended ?? null;
  const theoreticalMin = fleet?.theoreticalMin ?? null;

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;

    const gap = 12;
    const viewPad = 8;
    const spaceAbove = Math.max(48, pos.clientY - viewPad - gap);
    const maxHeight = Math.min(140, spaceAbove);
    const tipRect = tip.getBoundingClientRect();
    const half = tipRect.width / 2;
    const left = Math.min(
      Math.max(pos.clientX, half + viewPad),
      window.innerWidth - half - viewPad,
    );
    setPlaced({
      top: pos.clientY - gap,
      left,
      maxHeight,
    });
  }, [pos.clientX, pos.clientY, existingVehicles, recommendedVehicles, theoreticalMin, segment.startMinute, segment.endMinute, segment.headwaySeconds]);

  return createPortal(
    <div
      ref={tipRef}
      className={[
        'pointer-events-none fixed z-[10050] w-max max-w-[200px] -translate-x-1/2 -translate-y-full overflow-y-auto rounded-md border border-zinc-700/90 bg-zinc-950 px-2.5 py-1.5 shadow-xl shadow-black/40',
        placed ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
      style={{
        top: placed?.top ?? pos.clientY,
        left: placed?.left ?? pos.clientX,
        maxHeight: placed?.maxHeight ?? 140,
      }}
      role="tooltip"
    >
      <div className="text-[11px] font-medium leading-4 text-zinc-100">
        已排正線：{existingVehicles} 列
      </div>
      <div className="text-[11px] font-medium leading-4 text-zinc-100">
        建議列數：{recommendedVehicles != null ? `${recommendedVehicles} 列` : '—'}
        {theoreticalMin != null && theoreticalMin !== recommendedVehicles
          ? `（理論下限 ${theoreticalMin}）`
          : null}
      </div>
      <div className="mt-1 space-y-0.5 text-[10px] leading-[14px] tabular-nums text-zinc-300">
        <div>開始：{formatMinuteAsHms(segment.startMinute)}</div>
        <div>結束：{formatMinuteAsHms(segment.endMinute)}</div>
        {segment.headwaySeconds ? (
          <div>班距：{segment.headwaySeconds} 秒</div>
        ) : null}
      </div>
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-700/90"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

function TurnaroundLimitCell({
  segment,
  leftPx,
  widthPx,
  label,
  estimatedTripSeconds,
}: {
  segment: TurnaroundLimitSegment;
  leftPx: number;
  widthPx: number;
  label: string;
  estimatedTripSeconds?: number | null;
}) {
  const [pos, setPos] = useState<HoverCardPos | null>(null);

  return (
    <div
      className={`absolute inset-y-0 z-[1] flex items-center justify-center border-x border-zinc-700 bg-zinc-900/85 text-[11px] font-medium tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS} transition-colors hover:bg-zinc-800/85 hover:border-zinc-500`}
      style={{ left: leftPx, width: widthPx }}
      onMouseEnter={(e) => setPos({ clientX: e.clientX, clientY: e.clientY })}
      onMouseMove={(e) => setPos({ clientX: e.clientX, clientY: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      <span className="truncate px-1">{label}</span>
      {pos ? (
        <TurnaroundLimitHoverCard
          segment={segment}
          pos={pos}
          estimatedTripSeconds={estimatedTripSeconds}
        />
      ) : null}
    </div>
  );
}

export function TurnaroundLimitGrid({
  tasks,
  intervals,
  attributes,
  slotWidthPx,
  rowLabelWidth,
  estimatedTripSeconds,
}: TurnaroundLimitGridProps) {
  const segments = useMemo(
    () => computeTurnaroundLimitSegments(tasks, intervals, attributes),
    [tasks, intervals, attributes],
  );

  const trackWidthPx = SCHEDULE_VISIBLE_SLOTS * slotWidthPx;

  return (
    <div
      className="flex border-b border-zinc-800/80 bg-[#0a0a0c]/95"
      style={{ height: TURNAROUND_LIMIT_ROW_HEIGHT_PX }}
    >
      <div
        className={`sticky left-0 z-20 flex shrink-0 items-center justify-center border-r border-zinc-800/60 bg-[#0a0a0c]/95 ${SCHEDULE_TIME_AXIS_TEXT_INACTIVE_CLASS}`}
        style={{ width: rowLabelWidth }}
        title={`${TURNAROUND_LIMIT_ROW_TITLE}：${TURNAROUND_LIMIT_ROW_HINT}`}
        aria-label={TURNAROUND_LIMIT_ROW_TITLE}
      >
        <Lightbulb className="size-3.5" aria-hidden />
      </div>

      <div className="relative shrink-0" style={{ width: trackWidthPx, height: TURNAROUND_LIMIT_ROW_HEIGHT_PX }}>
        <div className="pointer-events-none absolute inset-0 z-0">
          <ScheduleTimelineBackground
            intervals={intervals}
            attributes={attributes}
            slotWidthPx={slotWidthPx}
          />
        </div>

        {segments.length === 0 ? (
          <div className="relative z-[1] flex h-full items-center px-2 text-[10px] text-zinc-600">
            尚無載客任務
          </div>
        ) : (
          segments.map((segment) => {
            const leftPx = (segment.startMinute / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
            const widthPx =
              ((segment.endMinute - segment.startMinute) / SCHEDULE_SLOT_MINUTES) * slotWidthPx;
            
            const existingVehicles = segment.activePassengerCount;
            const fleet = recommendFleetRowCount({
              cycleSeconds: estimatedTripSeconds ?? 0,
              headwaySeconds: segment.headwaySeconds ?? 0,
              intervalDurationSeconds: (segment.endMinute - segment.startMinute) * 60,
            });
            const recommendedVehicles = fleet?.recommended ?? null;

            const label = `已排: ${existingVehicles}列, 建議: ${
              recommendedVehicles != null ? `${recommendedVehicles}列` : '—列'
            }`;

            return (
              <TurnaroundLimitCell
                key={`${segment.startMinute}-${segment.endMinute}`}
                segment={segment}
                leftPx={leftPx}
                widthPx={widthPx}
                label={label}
                estimatedTripSeconds={estimatedTripSeconds}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
