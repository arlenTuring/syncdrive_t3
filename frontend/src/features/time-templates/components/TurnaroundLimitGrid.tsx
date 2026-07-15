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
import { ScheduleTimelineBackground } from './scheduleTimelineBackground';

export const TURNAROUND_LIMIT_ROW_HEIGHT_PX = 30;

const TURNAROUND_LIMIT_ROW_TITLE = '正線建議';
const TURNAROUND_LIMIT_ROW_HINT =
  '依據設定的班距與整趟路線時間，建議合適的載客車輛數。';

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
  top: number;
  left: number;
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
  const existingVehicles = segment.activePassengerCount;
  const recommendedVehicles =
    segment.headwaySeconds && segment.headwaySeconds > 0 && estimatedTripSeconds
      ? Math.ceil(estimatedTripSeconds / segment.headwaySeconds)
      : null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-700/90 bg-zinc-950 px-2.5 py-2 shadow-2xl shadow-black/50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="text-[11px] font-medium leading-4 text-zinc-100">
        已排：{existingVehicles} 台
      </div>
      <div className="text-[11px] font-medium leading-4 text-zinc-100">
        建議：{recommendedVehicles != null ? `${recommendedVehicles} 台` : '—'}
      </div>
      <div className="mt-1 space-y-0.5 text-[10px] leading-4 tabular-nums text-[#F3F4F6]">
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
  const cellRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<HoverCardPos | null>(null);

  useLayoutEffect(() => {
    if (!hovered) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = cellRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [hovered]);

  return (
    <div
      ref={cellRef}
      className={`absolute inset-y-0 z-[1] flex items-center justify-center border-x border-zinc-700 bg-zinc-900/85 text-[11px] font-medium tabular-nums ${SCHEDULE_TIME_AXIS_TEXT_CLASS} transition-colors hover:bg-zinc-800/85 hover:border-zinc-500`}
      style={{ left: leftPx, width: widthPx }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="truncate px-1">{label}</span>
      {hovered && pos ? (
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
            const recommendedVehicles =
              segment.headwaySeconds && segment.headwaySeconds > 0 && estimatedTripSeconds
                ? Math.ceil(estimatedTripSeconds / segment.headwaySeconds)
                : null;

            const label = `已排: ${existingVehicles}台, 建議: ${
              recommendedVehicles != null ? `${recommendedVehicles}台` : '—台'
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
