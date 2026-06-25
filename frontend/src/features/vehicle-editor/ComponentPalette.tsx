import { VEHICLE_PALETTE } from './constants/palette';
import type { VehicleElementType } from './types';

export function ComponentPalette({
  isEditMode,
  onAddAtCenter,
}: {
  isEditMode: boolean;
  onAddAtCenter?: (type: VehicleElementType) => void;
}) {
  if (!isEditMode) return null;

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">元件</span>
        {VEHICLE_PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-vehicle-element', item.type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAddAtCenter?.(item.type)}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-800"
            title={item.description}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </button>
        ))}
        <span className="text-[10px] text-zinc-600">拖曳至畫布或外圍放置 · 行為請放畫布外</span>
      </div>
    </div>
  );
}

export type { VehicleElementType };
