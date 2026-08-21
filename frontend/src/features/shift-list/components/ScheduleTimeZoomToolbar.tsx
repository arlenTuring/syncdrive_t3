import { Minus, Plus } from 'lucide-react';
import {
  clampGridZoom,
  GRID_ZOOM_MAX,
  GRID_ZOOM_MIN,
  GRID_ZOOM_STEP,
} from '../../time-templates/types/editor';

type ScheduleTimeZoomToolbarProps = {
  zoom: number;
  onChange: (zoom: number) => void;
  /** 獨立成一組邊框工具列（預覽頁）；調整步驟已包在更大的工具列裡 */
  standalone?: boolean;
};

/**
 * 班表格線時間刻度縮放（−／讀數／＋）。
 * 讀數固定寬度，倍率從 40% 變到 300% 時工具列不會跟著抖。
 */
export function ScheduleTimeZoomToolbar({
  zoom,
  onChange,
  standalone = false,
}: ScheduleTimeZoomToolbarProps) {
  const inner = (
    <>
      <button
        type="button"
        disabled={zoom <= GRID_ZOOM_MIN}
        onClick={() => onChange(clampGridZoom(zoom - GRID_ZOOM_STEP))}
        className={`rounded p-1.5 transition ${
          zoom > GRID_ZOOM_MIN
            ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
            : 'cursor-not-allowed text-zinc-600 opacity-40'
        }`}
        title="時間刻度縮小"
      >
        <Minus className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => onChange(1)}
        className="w-10 shrink-0 rounded py-1 text-center text-[11px] tabular-nums text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
        title="時間刻度：點擊回到自動寬度"
      >
        {Math.round(zoom * 100)}%
      </button>

      <button
        type="button"
        disabled={zoom >= GRID_ZOOM_MAX}
        onClick={() => onChange(clampGridZoom(zoom + GRID_ZOOM_STEP))}
        className={`rounded p-1.5 transition ${
          zoom < GRID_ZOOM_MAX
            ? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
            : 'cursor-not-allowed text-zinc-600 opacity-40'
        }`}
        title="時間刻度放大"
      >
        <Plus className="size-4" />
      </button>
    </>
  );

  if (!standalone) return inner;

  return (
    <div className="flex shrink-0 select-none items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1">
      {inner}
    </div>
  );
}
