import {
  MAP_ZOOM_FACTOR_MAX,
  MAP_ZOOM_FACTOR_MIN,
  VIEW_BASELINE_HEIGHT_M,
  VIEW_BASELINE_WIDTH_M,
  clampMapZoomFactor,
} from '../constants/map'

type TrajectoryZoomBarProps = {
  zoomFactorX: number
  onZoomFactorXChange: (v: number) => void
  zoomFactorY: number
  onZoomFactorYChange: (v: number) => void
}

/** 軌跡圖台專用；地圖圖台縮放在頂部工具列 */
export function TrajectoryZoomBar({
  zoomFactorX,
  onZoomFactorXChange,
  zoomFactorY,
  onZoomFactorYChange,
}: TrajectoryZoomBarProps) {
  const min = MAP_ZOOM_FACTOR_MIN
  const max = MAP_ZOOM_FACTOR_MAX
  const step = 0.05

  return (
    <div
      className="pointer-events-auto flex shrink-0 flex-wrap items-end gap-x-6 gap-y-3 border-t border-zinc-700/80 bg-zinc-950/95 px-4 py-2"
      role="group"
      aria-label="軌跡圖台縮放"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          軌跡圖台縮放（橫／縱分開）
        </span>
        <p className="text-[9px] leading-snug text-zinc-600">
          倍率愈大該軸可視愈大：寬 ≈{' '}
          <span className="font-mono text-zinc-500">
            {VIEW_BASELINE_WIDTH_M}×倍率
          </span>
          m、高 ≈{' '}
          <span className="font-mono text-zinc-500">
            {VIEW_BASELINE_HEIGHT_M}×倍率
          </span>
          m。不寫入檔案。
        </p>
      </div>

      <label className="flex min-w-[10rem] max-w-sm flex-1 flex-col gap-1">
        <span className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>橫向（左右）</span>
          <span className="font-mono text-cyan-400/90">
            {zoomFactorX.toFixed(2)}×
          </span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={zoomFactorX}
          onChange={(e) =>
            onZoomFactorXChange(clampMapZoomFactor(Number(e.target.value)))
          }
          className="h-1.5 w-full cursor-pointer accent-cyan-500"
        />
        <div className="flex justify-between text-[9px] text-zinc-600">
          <span>{min}×</span>
          <span>1×</span>
          <span>{max}×</span>
        </div>
      </label>

      <label className="flex min-w-[10rem] max-w-sm flex-1 flex-col gap-1">
        <span className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>縱向（上下）</span>
          <span className="font-mono text-cyan-400/90">
            {zoomFactorY.toFixed(2)}×
          </span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={zoomFactorY}
          onChange={(e) =>
            onZoomFactorYChange(clampMapZoomFactor(Number(e.target.value)))
          }
          className="h-1.5 w-full cursor-pointer accent-cyan-500"
        />
        <div className="flex justify-between text-[9px] text-zinc-600">
          <span>{min}×</span>
          <span>1×</span>
          <span>{max}×</span>
        </div>
      </label>

      <button
        type="button"
        onClick={() => {
          onZoomFactorXChange(1)
          onZoomFactorYChange(1)
        }}
        className="shrink-0 rounded border border-zinc-600 px-2 py-1.5 text-[10px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
      >
        橫縱重設 1×
      </button>
    </div>
  )
}
