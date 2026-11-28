import { Slider } from '../../../components/ui';
import {
  VEHICLE_CAPACITY_MAX,
  VEHICLE_CAPACITY_MIN,
} from '../types/editor';

const VALUE_COLUMN_WIDTH_PX = 64;
const TRACK_ROW_HEIGHT_PX = 36;
const TRACK_VALUE_GAP_PX = 10;

type VehicleCapacitySliderProps = {
  value: number;
  onChange: (value: number) => void;
  /** 標籤已顯示在欄位上方時，隱藏數值下方的重複文字 */
  hideValueSublabel?: boolean;
};

/** 車體載運量：T3 UI Kit Slider（數值另外顯示在右側欄，所以滑桿本身不顯示數值標籤） */
export function VehicleCapacitySlider({
  value,
  onChange,
  hideValueSublabel = false,
}: VehicleCapacitySliderProps) {
  return (
    <div className="flex w-full items-center" style={{ gap: TRACK_VALUE_GAP_PX }}>
      <Slider
        min={VEHICLE_CAPACITY_MIN}
        max={VEHICLE_CAPACITY_MAX}
        step={1}
        value={value}
        onChange={onChange}
        showLabel={false}
        aria-label="車體載運量"
        className="min-w-0 flex-1"
      />

      <div
        className="flex shrink-0 flex-col items-center justify-center"
        style={{ width: VALUE_COLUMN_WIDTH_PX, height: TRACK_ROW_HEIGHT_PX }}
      >
        <span className="text-body-s-bold tabular-nums text-text-primary">
          {value}
        </span>
        {!hideValueSublabel && (
          <span className="whitespace-nowrap text-caption-2 text-text-tertiary">車體載運量</span>
        )}
      </div>
    </div>
  );
}
