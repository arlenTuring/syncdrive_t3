import { useEffect, useId, useState } from 'react'
import {
  clampMapPixelSize,
  DEFAULT_MAP_PIXEL_HEIGHT,
  DEFAULT_MAP_PIXEL_WIDTH,
  MAX_MAP_PIXEL,
  MIN_MAP_PIXEL,
  type MapPixelSize,
} from '../constants/mapPixel'

type Props = {
  open: boolean
  initialPixelSize?: MapPixelSize
  onConfirm: (pixelSize: MapPixelSize) => void
  onCancel: () => void
}

export function NewMapPixelDialog({
  open,
  initialPixelSize,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const [widthStr, setWidthStr] = useState(
    String(initialPixelSize?.width ?? DEFAULT_MAP_PIXEL_WIDTH),
  )
  const [heightStr, setHeightStr] = useState(
    String(initialPixelSize?.height ?? DEFAULT_MAP_PIXEL_HEIGHT),
  )

  useEffect(() => {
    if (!open) return
    setWidthStr(String(initialPixelSize?.width ?? DEFAULT_MAP_PIXEL_WIDTH))
    setHeightStr(String(initialPixelSize?.height ?? DEFAULT_MAP_PIXEL_HEIGHT))
  }, [open, initialPixelSize?.width, initialPixelSize?.height])

  if (!open) return null

  const submit = () => {
    const width = Number.parseInt(widthStr, 10)
    const height = Number.parseInt(heightStr, 10)
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      alert('請輸入有效的畫布寬度與高度（像素）')
      return
    }
    onConfirm(clampMapPixelSize({ width, height }))
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-100">
          設定監控畫布大小
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          決定 Map 圖台的顯示像素尺寸。Area 容器與設施將擺在此畫布上；各 Area
          的實際場域公尺範圍在 Area 屬性中另行設定。
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-xs text-zinc-500">
            寬度（px）
            <input
              type="number"
              min={MIN_MAP_PIXEL}
              max={MAX_MAP_PIXEL}
              step={1}
              value={widthStr}
              onChange={(e) => setWidthStr(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block text-xs text-zinc-500">
            高度（px）
            <input
              type="number"
              min={MIN_MAP_PIXEL}
              max={MAX_MAP_PIXEL}
              step={1}
              value={heightStr}
              onChange={(e) => setHeightStr(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500"
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          允許範圍 {MIN_MAP_PIXEL}–{MAX_MAP_PIXEL} px。預設 {DEFAULT_MAP_PIXEL_WIDTH}×
          {DEFAULT_MAP_PIXEL_HEIGHT} px。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md border border-cyan-700 bg-cyan-950/60 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-900/50"
          >
            建立空白圖台
          </button>
        </div>
      </div>
    </div>
  )
}
