import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatSelectedIntervalHoverContent,
  resolveIntervalTrackLayout,
  softHighlightColumnStyle,
  type TimeSlotAttribute,
  type TimeSlotInterval,
} from '../types/editor';

type HoverCardPos = {
  top: number;
  left: number;
};

function IntervalAttributeHoverCard({
  interval,
  attribute,
  pos,
  estimatedTripSeconds,
}: {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  pos: HoverCardPos;
  estimatedTripSeconds?: number | null;
}) {
  const content = formatSelectedIntervalHoverContent(interval, attribute, estimatedTripSeconds);
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

type ScheduleIntervalHeaderHitProps = {
  interval: TimeSlotInterval;
  attribute: TimeSlotAttribute | undefined;
  leftPx: number;
  widthPx: number;
  selected: boolean;
  onSelect: (intervalId: string) => void;
  estimatedTripSeconds?: number | null;
};

function ScheduleIntervalHeaderHit({
  interval,
  attribute,
  leftPx,
  widthPx,
  selected,
  onSelect,
  estimatedTripSeconds,
}: ScheduleIntervalHeaderHitProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<HoverCardPos | null>(null);
  const showTooltip = hovered;

  useLayoutEffect(() => {
    if (!showTooltip) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
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
  }, [showTooltip]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-pressed={selected}
        aria-label={`${interval.name} ${interval.startTime} — ${interval.endTime}`}
        className="pointer-events-auto absolute inset-y-0 cursor-pointer border-0 bg-transparent p-0"
        style={{ left: leftPx, width: widthPx }}
        onClick={() => onSelect(interval.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {showTooltip && pos ? (
        <IntervalAttributeHoverCard
          interval={interval}
          attribute={attribute}
          pos={pos}
          estimatedTripSeconds={estimatedTripSeconds}
        />
      ) : null}
    </>
  );
}

type SharedIntervalSelectionProps = {
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  slotWidthPx: number;
  scheduleSlotMinutes: number;
  trackWidthPx: number;
  selectedIntervalId: string | null;
  onSelectIntervalId: (intervalId: string | null) => void;
  estimatedTripSeconds?: number | null;
};

function useConfirmedIntervalSlots(intervals: TimeSlotInterval[]) {
  return intervals.filter((slot) => !slot.isDraft);
}

function SelectedIntervalColumnBand({
  leftPx,
  widthPx,
  accent,
}: {
  leftPx: number;
  widthPx: number;
  accent: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 transition-[box-shadow,background-color] duration-150"
      style={{
        left: leftPx,
        width: widthPx,
        ...softHighlightColumnStyle(accent),
      }}
    />
  );
}

function resolveSelectedIntervalBand(
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
  slotWidthPx: number,
  scheduleSlotMinutes: number,
  selectedIntervalId: string | null,
): { leftPx: number; widthPx: number; accent: string } | null {
  const selectedSlot = intervals
    .filter((slot) => !slot.isDraft)
    .find((slot) => slot.id === selectedIntervalId);
  if (!selectedSlot) return null;
  const layout = resolveIntervalTrackLayout(selectedSlot, slotWidthPx, scheduleSlotMinutes);
  if (!layout) return null;
  const attribute = attributes.find((item) => item.id === selectedSlot.attributeId);
  return {
    ...layout,
    accent: attribute?.color ?? '#7C86FF',
  };
}

/** 整欄包覆高亮：貫穿折返列與甘特列（header 另繪一層） */
export function ScheduleIntervalColumnHighlight({
  intervals,
  attributes,
  slotWidthPx,
  scheduleSlotMinutes,
  trackWidthPx,
  rowLabelWidth,
  selectedIntervalId,
}: Omit<SharedIntervalSelectionProps, 'onSelectIntervalId'> & { rowLabelWidth: number }) {
  const band = resolveSelectedIntervalBand(
    intervals,
    attributes,
    slotWidthPx,
    scheduleSlotMinutes,
    selectedIntervalId,
  );

  if (!band) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-[1]"
      style={{ left: rowLabelWidth, width: trackWidthPx }}
      aria-hidden
    >
      <SelectedIntervalColumnBand
        leftPx={band.leftPx}
        widthPx={band.widthPx}
        accent={band.accent}
      />
    </div>
  );
}

/** sticky 時間軸區塊內的同欄高亮（避免被 header 底色蓋住） */
export function ScheduleIntervalHeaderColumnHighlight({
  intervals,
  attributes,
  slotWidthPx,
  scheduleSlotMinutes,
  trackWidthPx,
  rowLabelWidth,
  selectedIntervalId,
}: Omit<SharedIntervalSelectionProps, 'onSelectIntervalId'> & { rowLabelWidth: number }) {
  const band = resolveSelectedIntervalBand(
    intervals,
    attributes,
    slotWidthPx,
    scheduleSlotMinutes,
    selectedIntervalId,
  );

  if (!band) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-[12]"
      style={{ left: rowLabelWidth, width: trackWidthPx }}
      aria-hidden
    >
      <SelectedIntervalColumnBand
        leftPx={band.leftPx}
        widthPx={band.widthPx}
        accent={band.accent}
      />
    </div>
  );
}

/** 頂部時間軸點擊／hover 感應（置於 sticky header 內） */
export function ScheduleIntervalHeaderHits({
  intervals,
  attributes,
  slotWidthPx,
  scheduleSlotMinutes,
  trackWidthPx,
  rowLabelWidth,
  selectedIntervalId,
  onSelectIntervalId,
  estimatedTripSeconds,
}: SharedIntervalSelectionProps & { rowLabelWidth: number }) {
  const confirmed = useConfirmedIntervalSlots(intervals);

  const handleSelect = (intervalId: string) => {
    onSelectIntervalId(selectedIntervalId === intervalId ? null : intervalId);
  };

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-30"
      style={{ left: rowLabelWidth, width: trackWidthPx }}
    >
      <div className="relative h-full w-full">
        {confirmed.map((slot) => {
          const layout = resolveIntervalTrackLayout(slot, slotWidthPx, scheduleSlotMinutes);
          if (!layout) return null;
          const attribute = attributes.find((item) => item.id === slot.attributeId);
          return (
            <ScheduleIntervalHeaderHit
              key={slot.id}
              interval={slot}
              attribute={attribute}
              leftPx={layout.leftPx}
              widthPx={layout.widthPx}
              selected={selectedIntervalId === slot.id}
              onSelect={handleSelect}
              estimatedTripSeconds={estimatedTripSeconds}
            />
          );
        })}
      </div>
    </div>
  );
}
