import { memo, useMemo } from 'react'
import { metersToWorldPx } from '../constants/map'
import { useMapExtent } from '../context/MapExtentContext'
import type { ParsedTrajectory } from '../types/trajectoryFile'

type TrajectoryLayerProps = {
  trajectory: ParsedTrajectory | null
  /** 自走車標示在第幾個點（0-based）；null 表示不顯示標示（僅路徑與點） */
  replayHeadIndex: number | null
}

/** 超過此數僅畫折線與起訖標記，避免大量 SVG 圓點拖慢渲染 */
const MAX_VERTEX_DOTS = 64

function toWorldPx(tr: ParsedTrajectory): { x: number; y: number }[] {
  return tr.points.map((p) => ({
    x: metersToWorldPx(p.positionMeters.x),
    y: metersToWorldPx(p.positionMeters.y),
  }))
}

export const TrajectoryLayer = memo(function TrajectoryLayer({
  trajectory,
  replayHeadIndex,
}: TrajectoryLayerProps) {
  const { worldW: mapWorldW, worldH: mapWorldH } = useMapExtent()
  const { pts, linePoints, head, dense } = useMemo(() => {
    if (!trajectory || trajectory.points.length === 0) {
      return {
        pts: [] as { x: number; y: number }[],
        linePoints: '',
        head: null as { x: number; y: number } | null,
        dense: false,
      }
    }
    const pts = toWorldPx(trajectory)
    const linePoints = pts.map((p) => `${p.x},${p.y}`).join(' ')
    const dense = pts.length > MAX_VERTEX_DOTS
    const head =
      replayHeadIndex !== null &&
      replayHeadIndex >= 0 &&
      replayHeadIndex < pts.length
        ? pts[replayHeadIndex]
        : null
    return { pts, linePoints, head, dense }
  }, [trajectory, replayHeadIndex])

  if (!trajectory || trajectory.points.length === 0) return null

  const start = pts[0]
  const end = pts[pts.length - 1]

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={mapWorldW}
      height={mapWorldH}
      style={{ zIndex: 25 }}
      aria-hidden
    >
      <title>{trajectory.displayName}</title>
      {pts.length >= 2 && (
        <polyline
          fill="none"
          stroke="rgba(34, 211, 238, 0.95)"
          strokeWidth={dense ? 3 : 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />
      )}
      {!dense &&
        pts.map((p, i) => (
          <circle
            key={`tr-pt-${i}`}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={
              replayHeadIndex !== null && i <= replayHeadIndex
                ? 'rgba(34, 211, 238, 0.55)'
                : 'rgba(113, 113, 122, 0.45)'
            }
            stroke="rgba(228, 228, 231, 0.35)"
            strokeWidth={1}
          />
        ))}
      {dense && (
        <>
          <circle
            cx={start.x}
            cy={start.y}
            r={5}
            fill="rgba(34, 197, 94, 0.45)"
            stroke="rgba(34, 197, 94, 0.85)"
            strokeWidth={1}
          />
          <circle
            cx={end.x}
            cy={end.y}
            r={5}
            fill="rgba(59, 130, 246, 0.4)"
            stroke="rgba(96, 165, 250, 0.85)"
            strokeWidth={1}
          />
        </>
      )}
      {head && (
        <g>
          <circle
            cx={head.x}
            cy={head.y}
            r={11}
            fill="rgba(250, 204, 21, 0.25)"
            stroke="rgba(250, 204, 21, 0.9)"
            strokeWidth={2}
          />
          <circle cx={head.x} cy={head.y} r={5} fill="rgb(250, 204, 21)" />
        </g>
      )}
    </svg>
  )
})
