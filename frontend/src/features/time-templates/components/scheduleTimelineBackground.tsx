import {
  SCHEDULE_SLOT_MINUTES,
  SCHEDULE_VISIBLE_SLOTS,
  blendHexOnBase,
  parseIntervalStartMinutes,
  parseIntervalEndMinutes,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';

type ScheduleTimelineBackgroundProps = {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
};

export function ScheduleTimelineBackground({
  intervals,
  attributes,
  slotWidthPx,
}: ScheduleTimelineBackgroundProps) {
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
