import { useMemo, type CSSProperties } from 'react'
import type { OpenDrivePlan } from '../opendrive'
import {
  laneFillColor,
  lanePolygonToSvgPath,
  laneStrokeColor,
} from '../opendrive'
import type { BasemapWorldBounds } from '../utils/basemapGrid'

type Props = {
  cellWorldBounds: BasemapWorldBounds
  parentWorldBounds: BasemapWorldBounds
  widthPx: number
  heightPx: number
  parentWidthPx: number
  parentHeightPx: number
  contentOpacity?: number
  imageUrl: string | null
  xodrPlan: OpenDrivePlan | null
  fileName?: string | null
}

function imageTileStyle(
  cellBounds: BasemapWorldBounds,
  parentBounds: BasemapWorldBounds,
  parentWidthPx: number,
  parentHeightPx: number,
  cellWidthPx: number,
  cellHeightPx: number,
): CSSProperties {
  const parentW = parentBounds.xmax - parentBounds.xmin
  const parentH = parentBounds.ymax - parentBounds.ymin
  const leftNorm = (cellBounds.xmin - parentBounds.xmin) / parentW
  const topNorm = (parentBounds.ymax - cellBounds.ymax) / parentH
  const widthNorm = (cellBounds.xmax - cellBounds.xmin) / parentW
  const heightNorm = (cellBounds.ymax - cellBounds.ymin) / parentH

  const srcLeft = leftNorm * parentWidthPx
  const srcTop = topNorm * parentHeightPx
  const srcW = Math.max(1e-6, widthNorm * parentWidthPx)
  const srcH = Math.max(1e-6, heightNorm * parentHeightPx)
  const scaleX = cellWidthPx / srcW
  const scaleY = cellHeightPx / srcH

  return {
    position: 'absolute',
    left: -srcLeft * scaleX,
    top: -srcTop * scaleY,
    width: parentWidthPx * scaleX,
    height: parentHeightPx * scaleY,
    maxWidth: 'none',
    objectFit: 'fill',
  }
}

function OpenDriveCellSvg({
  plan,
  cellWorldBounds,
  widthPx,
  heightPx,
}: {
  plan: OpenDrivePlan
  cellWorldBounds: BasemapWorldBounds
  widthPx: number
  heightPx: number
}) {
  const paths = useMemo(
    () =>
      plan.lanes.map((lane) => ({
        key: `${lane.roadId}-${lane.laneId}-${lane.mmslLaneId ?? 'x'}`,
        d: lanePolygonToSvgPath(
          lane.points,
          cellWorldBounds,
          widthPx,
          heightPx,
        ),
        laneType: lane.laneType,
      })),
    [cellWorldBounds, heightPx, plan.lanes, widthPx],
  )

  return (
    <svg
      width={widthPx}
      height={heightPx}
      className="block size-full bg-transparent"
      aria-hidden
    >
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill={laneFillColor(p.laneType)}
          stroke={laneStrokeColor(p.laneType)}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/**
 * 單格底圖：固定世界範圍內容縮放至格子的像素尺寸（非裁切視窗）。
 */
export function BasemapCellContent({
  cellWorldBounds,
  parentWorldBounds,
  widthPx,
  heightPx,
  parentWidthPx,
  parentHeightPx,
  contentOpacity = 1,
  imageUrl,
  xodrPlan,
  fileName = null,
}: Props) {
  const contentStyle = { opacity: Math.max(0, Math.min(1, contentOpacity)) }

  const imageStyle = useMemo(
    () =>
      imageTileStyle(
        cellWorldBounds,
        parentWorldBounds,
        parentWidthPx,
        parentHeightPx,
        widthPx,
        heightPx,
      ),
    [
      cellWorldBounds,
      heightPx,
      parentHeightPx,
      parentWidthPx,
      parentWorldBounds,
      widthPx,
    ],
  )

  if (xodrPlan) {
    return (
      <div className="size-full overflow-hidden" style={contentStyle}>
        <OpenDriveCellSvg
          plan={xodrPlan}
          cellWorldBounds={cellWorldBounds}
          widthPx={widthPx}
          heightPx={heightPx}
        />
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div className="relative size-full overflow-hidden" style={contentStyle}>
        <img
          src={imageUrl}
          alt={fileName ?? '底圖'}
          className="pointer-events-none"
          style={imageStyle}
          draggable={false}
        />
      </div>
    )
  }

  return null
}
