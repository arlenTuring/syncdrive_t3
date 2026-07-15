import { Check } from 'lucide-react';
import { ATTRIBUTE_COLOR_PALETTE } from '../types/editor';

type AttributeColorPaletteProps = {
  value: string;
  onChange: (color: string) => void;
};

export function AttributeColorPalette({ value, onChange }: AttributeColorPaletteProps) {
  return (
    <div
      className="relative z-30 w-[144px] rounded-lg p-2 shadow-xl"
      style={{
        background:
          'linear-gradient(0deg, rgba(184, 204, 242, 0.1), rgba(184, 204, 242, 0.1)), #27272A',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        className="absolute -bottom-[7px] left-3 size-0 border-x-[5px] border-t-[7.5px] border-x-transparent"
        style={{
          borderTopColor: '#27272A',
        }}
        aria-hidden
      />
      <div className="flex w-[128px] flex-col gap-1">
        <span className="text-xs leading-4 text-[#F3F4F6]">Color</span>
        <div className="flex w-[128px] flex-wrap gap-1">
          {ATTRIBUTE_COLOR_PALETTE.map((color) => {
            const selected = value === color;
            return (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                className="flex size-[18px] items-center justify-center rounded bg-[rgba(212,212,216,0.1)] p-0.5"
                aria-label={`選擇顏色 ${color}`}
                aria-pressed={selected}
              >
                <span
                  className="relative flex size-[14px] items-center justify-center rounded-[3px]"
                  style={{ backgroundColor: color }}
                >
                  {selected && <Check className="size-2.5 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
