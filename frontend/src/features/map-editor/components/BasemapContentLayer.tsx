import { useMemo } from 'react'
import type { OpenDrivePlan } from '../opendrive'
import {
  laneFillColor,
  lanePolygonToSvgPath,
  laneStrokeColor,
} from '../opendrive'

type Props = {
  width: number
  height: number
  contentOpacity?: number
  imageUrl: string | null
  xodrPlan: OpenDrivePlan | null
  fileName?: string | null
}

function OpenDriveBasemapSvg({
  plan,
  width,
  height,
}: {
  plan: OpenDrivePlan
  width: number
  height: number
}) {
  const paths = useMemo(
    () =>
      plan.lanes.map((lane) => ({
        key: `${lane.roadId}-${lane.laneId}-${lane.mmslLaneId ?? 'x'}`,
        d: lanePolygonToSvgPath(lane.points, plan.bounds, width, height),
        laneType: lane.laneType,
      })),
    [plan, width, height],
  )

  return (
    <svg
      width={width}
      height={height}
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

/** 底圖內容層（圖片或 OpenDRIVE），不含格線 */
export function BasemapContentLayer({
  width,
  height,
  contentOpacity = 1,
  imageUrl,
  xodrPlan,
  fileName = null,
}: Props) {
  const contentStyle = { opacity: Math.max(0, Math.min(1, contentOpacity)) }

  if (xodrPlan) {
    return (
      <div className="size-full" style={contentStyle}>
        <OpenDriveBasemapSvg plan={xodrPlan} width={width} height={height} />
      </div>
    )
  }

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={fileName ?? '底圖'}
        className="pointer-events-none size-full object-contain"
        style={contentStyle}
        draggable={false}
      />
    )
  }

  return null
}
