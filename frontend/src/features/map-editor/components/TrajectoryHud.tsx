import { memo, useMemo } from 'react'
import type { ParsedTrajectory } from '../types/trajectoryFile'
import { formatTrajectoryPointTime } from '../utils/trajectoryFormat'

type TrajectoryHudProps = {
  trajectory: ParsedTrajectory
  replayHeadIndex: number | null
}

export const TrajectoryHud = memo(function TrajectoryHud({
  trajectory,
  replayHeadIndex,
}: TrajectoryHudProps) {
  const { point, index, total } = useMemo(() => {
    const pts = trajectory.points
    const n = pts.length
    if (n === 0) {
      return { point: null as (typeof pts)[0] | null, index: -1, total: 0 }
    }
    let i =
      replayHeadIndex !== null &&
      replayHeadIndex >= 0 &&
      replayHeadIndex < n
        ? replayHeadIndex
        : 0
    return { point: pts[i], index: i, total: n }
  }, [trajectory.points, replayHeadIndex])

  if (!point || total === 0) return null

  const { x, y } = point.positionMeters

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[min(100%,20rem)] rounded-md border border-cyan-500/35 bg-zinc-950/90 px-3 py-2 font-mono text-[11px] leading-snug text-zinc-200 shadow-lg backdrop-blur-sm"
      aria-live="polite"
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-cyan-400/90">
        目前軌跡點
      </div>
      <div className="mt-1 text-zinc-400">
        序號 <span className="text-zinc-100">{index + 1}</span> / {total}
      </div>
      <div className="mt-0.5 text-zinc-400">
        位置 (m){' '}
        <span className="text-zinc-100">
          x={x.toFixed(2)}, y={y.toFixed(2)}
        </span>
      </div>
      <div className="mt-0.5 text-zinc-400">
        時間 <span className="text-zinc-100">{formatTrajectoryPointTime(point.tMs)}</span>
      </div>
      <div className="mt-0.5 text-zinc-500">tMs={point.tMs}</div>
    </div>
  )
})
