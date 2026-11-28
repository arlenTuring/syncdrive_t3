import {
  MAP_ZOOM_FACTOR_MAX,
  MAP_ZOOM_FACTOR_MIN,
  VIEW_BASELINE_HEIGHT_M,
  VIEW_BASELINE_WIDTH_M,
  clampMapZoomFactor,
} from '../constants/map'
import { Button, Slider } from '../../../components/ui';

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
      className="pointer-events-auto flex shrink-0 flex-wrap items-end gap-x-6 gap-y-3 border-t border-border-quaternary bg-surface-popup px-4 py-2"
      role="group"
      aria-label="軌跡圖台縮放"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-caption-2 uppercase text-text-quaternary">
          軌跡圖台縮放（橫／縱分開）
        </span>
        <p className="text-caption-2 text-text-disabled">
          倍率愈大該軸可視愈大：寬 ≈{' '}
          <span className="font-mono text-text-quaternary">
            {VIEW_BASELINE_WIDTH_M}×倍率
          </span>
          m、高 ≈{' '}
          <span className="font-mono text-text-quaternary">
            {VIEW_BASELINE_HEIGHT_M}×倍率
          </span>
          m。不寫入檔案。
        </p>
      </div>

      <div className="flex min-w-[10rem] max-w-sm flex-1 flex-col gap-1">
        <span className="flex items-center justify-between text-caption-2 text-text-tertiary">
          <span>橫向（左右）</span>
          <span className="font-mono text-text-theme">
            {zoomFactorX.toFixed(2)}×
          </span>
        </span>
        <Slider
          min={min}
          max={max}
          step={step}
          value={zoomFactorX}
          onChange={(next) => onZoomFactorXChange(clampMapZoomFactor(next))}
          showLabel={false}
          aria-label="橫向（左右）倍率"
        />
        <div className="flex justify-between px-2.5 text-caption-2 text-text-disabled">
          <span>{min}×</span>
          <span>1×</span>
          <span>{max}×</span>
        </div>
      </div>

      <div className="flex min-w-[10rem] max-w-sm flex-1 flex-col gap-1">
        <span className="flex items-center justify-between text-caption-2 text-text-tertiary">
          <span>縱向（上下）</span>
          <span className="font-mono text-text-theme">
            {zoomFactorY.toFixed(2)}×
          </span>
        </span>
        <Slider
          min={min}
          max={max}
          step={step}
          value={zoomFactorY}
          onChange={(next) => onZoomFactorYChange(clampMapZoomFactor(next))}
          showLabel={false}
          aria-label="縱向（上下）倍率"
        />
        <div className="flex justify-between px-2.5 text-caption-2 text-text-disabled">
          <span>{min}×</span>
          <span>1×</span>
          <span>{max}×</span>
        </div>
      </div>

      <Button hierarchy="subordinate" variant="outlined" className="shrink-0" onPress={() => {
          onZoomFactorXChange(1)
          onZoomFactorYChange(1)
        }}>橫縱重設 1×</Button>
    </div>
  )
}
