import { NumberInput } from '../../../components/NumberInput'
import {
  clampMapPixelSize,
  MAX_MAP_PIXEL,
  MIN_MAP_PIXEL,
  type MapPixelSize,
} from '../constants/mapPixel'

type Props = {
  pixelSize: MapPixelSize
  minPixelSize: MapPixelSize
  readOnly: boolean
  onChange: (size: MapPixelSize) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
}

/** 未選 Area／設施時：監控畫布（解析度）屬性 */
export function MapCanvasInspectorSection({
  pixelSize,
  minPixelSize,
  readOnly,
  onChange,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const patch = (patch: Partial<MapPixelSize>) => {
    onChange(clampMapPixelSize({ ...pixelSize, ...patch }))
  }

  return (
    <aside data-inspector className="flex h-full min-h-0 flex-col bg-zinc-900/50">
      <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-amber-500/90">
        監控畫布
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-zinc-500">
          畫布像素尺寸即儀表板圖台解析度。點選畫布空白或工具列「畫布」後，拖曳
          <strong className="text-zinc-400">琥珀色外框</strong>
          的邊或角可放大／裁減解析度；縮小時不得小於現有 Area 範圍。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-zinc-500">
            寬度（px）
            <NumberInput
              min={Math.max(MIN_MAP_PIXEL, minPixelSize.width)}
              max={MAX_MAP_PIXEL}
              step={1}
              disabled={readOnly}
              value={pixelSize.width}
              onChange={(n) => patch({ width: Math.round(n) })}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </label>
          <label className="block text-xs text-zinc-500">
            高度（px）
            <NumberInput
              min={Math.max(MIN_MAP_PIXEL, minPixelSize.height)}
              max={MAX_MAP_PIXEL}
              step={1}
              disabled={readOnly}
              value={pixelSize.height}
              onChange={(n) => patch({ height: Math.round(n) })}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </label>
        </div>
        <p className="text-[10px] text-zinc-600">
          最小 {minPixelSize.width}×{minPixelSize.height} px（含 Area 邊距）· 允許{' '}
          {MIN_MAP_PIXEL}–{MAX_MAP_PIXEL} px
        </p>
      </div>
    </aside>
  )
}
