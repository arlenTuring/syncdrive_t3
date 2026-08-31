import { useMemo } from 'react'
import type { OpenDrivePlan } from '../opendrive'
import type { BasemapWorldBounds } from '../utils/basemapGrid'
import type { BasemapPartition } from '../utils/basemapPartition'
import { partitionCellsToPx } from '../utils/basemapPartition'
import { getPartitionCellWorldBounds } from '../utils/basemapPartitionWorld'
import { BasemapCellContent } from './BasemapCellContent'

type Props = {
  partition: BasemapPartition
  parentWorldBounds: BasemapWorldBounds
  basemapWidthPx: number
  basemapHeightPx: number
  contentOpacity?: number
  imageUrl: string | null
  xodrPlan: OpenDrivePlan | null
  fileName?: string | null
}

/**
 * 確定切割後：每格獨立縮放自己的底圖內容（世界範圍固定、像素尺寸可調）。
 * 格線仍由 BasemapGraphic 以整張底圖 worldBounds 繪製。
 */
export function BasemapPartitionContent({
  partition,
  parentWorldBounds,
  basemapWidthPx,
  basemapHeightPx,
  contentOpacity = 1,
  imageUrl,
  xodrPlan,
  fileName = null,
}: Props) {
  const cells = useMemo(
    () => partitionCellsToPx(partition, basemapWidthPx, basemapHeightPx),
    [partition, basemapWidthPx, basemapHeightPx],
  )

  if (!imageUrl && !xodrPlan) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1]"
      aria-hidden
      data-basemap-partition-content
    >
      {cells.map((cell) => {
        const cellWorldBounds = getPartitionCellWorldBounds(
          partition,
          cell.id,
          parentWorldBounds,
        )
        if (!cellWorldBounds) return null

        return (
          <div
            key={cell.id}
            data-basemap-cell-content={cell.id}
            className="absolute overflow-hidden"
            style={{
              left: cell.x,
              top: cell.y,
              width: cell.w,
              height: cell.h,
            }}
          >
            <BasemapCellContent
              cellWorldBounds={cellWorldBounds}
              parentWorldBounds={parentWorldBounds}
              widthPx={cell.w}
              heightPx={cell.h}
              parentWidthPx={basemapWidthPx}
              parentHeightPx={basemapHeightPx}
              contentOpacity={contentOpacity}
              imageUrl={imageUrl}
              xodrPlan={xodrPlan}
              fileName={fileName}
            />
          </div>
        )
      })}
    </div>
  )
}
