import { useMemo } from 'react'
import { Image, Plus } from 'lucide-react'
import type { OpenDrivePlan } from '../opendrive'
import type { BasemapWorldBounds } from '../utils/basemapGrid'
import { BasemapContentLayer } from './BasemapContentLayer'
import { BasemapGridOverlay } from './BasemapGridOverlay'

type Props = {
  width: number
  height: number
  worldBounds: BasemapWorldBounds
  mapScale?: number
  contentOpacity?: number
  imageUrl: string | null
  xodrPlan: OpenDrivePlan | null
  xodrParseFailed?: boolean
  fileName: string | null
  readOnly: boolean
  selected: boolean
  /** 確定切割後隱藏整張內容，改由 BasemapPartitionContent 分格顯示 */
  hideContent?: boolean
  onPickClick: () => void
}

export function BasemapGraphic({
  width,
  height,
  worldBounds,
  mapScale = 1,
  contentOpacity = 1,
  imageUrl,
  xodrPlan,
  xodrParseFailed = false,
  fileName,
  readOnly,
  selected,
  hideContent = false,
  onPickClick,
}: Props) {
  const buttonSize = Math.max(28, Math.min(width, height) * 0.14)
  const hasContent = !!imageUrl || !!xodrPlan
  const showContent = hasContent && !hideContent

  const grid = useMemo(
    () => (
      <BasemapGridOverlay
        bounds={worldBounds}
        widthPx={width}
        heightPx={height}
        mapScale={mapScale}
      />
    ),
    [worldBounds, width, height, mapScale],
  )

  if (xodrParseFailed) {
    return (
      <div className="relative size-full overflow-hidden rounded-sm">
        {grid}
        <div className="relative z-[1] flex size-full flex-col items-center justify-center gap-2 border border-dashed border-rose-500/50 bg-rose-950/20 px-3 text-center">
          <span className="text-xs text-rose-300">OpenDRIVE 解析失敗</span>
          {!readOnly ? (
            <button
              type="button"
              data-basemap-pick
              onClick={(e) => {
                e.stopPropagation()
                onPickClick()
              }}
              className="text-[11px] text-cyan-300 underline"
            >
              重新選擇檔案
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (hasContent) {
    return (
      <div className="relative size-full overflow-hidden rounded-sm">
        {grid}
        {showContent ? (
          <div className="relative z-[1] size-full">
            <BasemapContentLayer
              width={width}
              height={height}
              contentOpacity={contentOpacity}
              imageUrl={imageUrl}
              xodrPlan={xodrPlan}
              fileName={fileName}
            />
          </div>
        ) : null}
        {!readOnly && selected ? (
          <button
            type="button"
            data-basemap-pick
            title="更換底圖"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onPickClick()
            }}
            className="absolute bottom-2 right-2 z-[2] rounded-md border border-zinc-500/80 bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-200 shadow-md transition hover:border-cyan-500/70 hover:text-cyan-100"
          >
            更換底圖
          </button>
        ) : null}
        {xodrPlan && selected ? (
          <div className="pointer-events-none absolute left-2 top-2 z-[2] rounded-md border border-zinc-600/70 bg-zinc-900/85 px-2 py-1 text-[10px] text-zinc-400">
            OpenDRIVE · {xodrPlan.roadCount} 道路 · {xodrPlan.laneCount} 車道
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative size-full overflow-hidden rounded-sm">
      {grid}
      <div className="relative z-[1] flex size-full flex-col items-center justify-center gap-2 border border-dashed border-zinc-500/70 bg-zinc-900/20">
        {!readOnly ? (
          <button
            type="button"
            data-basemap-pick
            title="載入底圖"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onPickClick()
            }}
            className="flex items-center justify-center rounded-full border border-zinc-500/80 bg-zinc-800/90 text-zinc-200 shadow-md transition hover:border-cyan-500/70 hover:bg-zinc-700 hover:text-cyan-100"
            style={{ width: buttonSize, height: buttonSize }}
          >
            <Plus className="size-[55%]" strokeWidth={2.25} aria-hidden />
            <span className="sr-only">載入底圖</span>
          </button>
        ) : (
          <Image
            className="text-zinc-600"
            style={{ width: buttonSize * 0.55, height: buttonSize * 0.55 }}
            aria-hidden
          />
        )}
        <span className="pointer-events-none select-none text-center text-[11px] text-zinc-500">
          {readOnly ? '尚未設定底圖' : '點擊載入圖片或 .xodr'}
        </span>
      </div>
    </div>
  )
}
