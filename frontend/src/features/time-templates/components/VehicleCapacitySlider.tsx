import { useCallback, useRef } from 'react';
import {
  VEHICLE_CAPACITY_MAX,
  VEHICLE_CAPACITY_MIN,
} from '../types/editor';

const VALUE_COLUMN_WIDTH_PX = 64;
const TRACK_ROW_HEIGHT_PX = 36;
const TRACK_VALUE_GAP_PX = 10;

function valueToPercent(value: number): number {
  return ((value - VEHICLE_CAPACITY_MIN) / (VEHICLE_CAPACITY_MAX - VEHICLE_CAPACITY_MIN)) * 100;
}

function percentToValue(percent: number): number {
  const raw =
    VEHICLE_CAPACITY_MIN
    + (percent / 100) * (VEHICLE_CAPACITY_MAX - VEHICLE_CAPACITY_MIN);
  return Math.round(Math.min(VEHICLE_CAPACITY_MAX, Math.max(VEHICLE_CAPACITY_MIN, raw)));
}

type VehicleCapacitySliderProps = {
  value: number;
  onChange: (value: number) => void;
  /** 標籤已顯示在欄位上方時，隱藏數值下方的重複文字 */
  hideValueSublabel?: boolean;
};

export function VehicleCapacitySlider({
  value,
  onChange,
  hideValueSublabel = false,
}: VehicleCapacitySliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillPercent = valueToPercent(value);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const percent = ((clientX - rect.left) / rect.width) * 100;
      onChange(percentToValue(percent));
    },
    [onChange],
  );

  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);

    const onPointerMove = (ev: PointerEvent) => {
      updateFromClientX(ev.clientX);
    };
    const onPointerUp = () => {
      target.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div className="flex w-full items-center" style={{ gap: TRACK_VALUE_GAP_PX }}>
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={VEHICLE_CAPACITY_MIN}
        aria-valuemax={VEHICLE_CAPACITY_MAX}
        aria-valuenow={value}
        aria-label="車體載運量"
        tabIndex={0}
        className="relative flex min-w-0 flex-1 cursor-pointer select-none items-center outline-none"
        style={{ height: TRACK_ROW_HEIGHT_PX }}
        onPointerDown={onTrackPointerDown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            onChange(Math.min(VEHICLE_CAPACITY_MAX, value + 1));
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            onChange(Math.max(VEHICLE_CAPACITY_MIN, value - 1));
          }
        }}
      >
        <div className="relative h-1 w-full rounded-full bg-[#3F3F46]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#2B7FFF]"
            style={{ width: `${fillPercent}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-[#2B7FFF] shadow-[0_0_0_1px_rgba(43,127,255,0.45)]"
            style={{ left: `${fillPercent}%` }}
          />
        </div>
      </div>

      <div
        className="flex shrink-0 flex-col items-center justify-center"
        style={{ width: VALUE_COLUMN_WIDTH_PX, height: TRACK_ROW_HEIGHT_PX }}
      >
        <span className="text-sm font-medium leading-5 tabular-nums text-[#F3F4F6]">
          {value}
        </span>
        {!hideValueSublabel && (
          <span className="whitespace-nowrap text-[10px] leading-4 text-[#99A1AF]">車體載運量</span>
        )}
      </div>
    </div>
  );
}
