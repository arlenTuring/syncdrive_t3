import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import type { ParsedTrajectory } from '../types/trajectoryFile'

type TrajectoryRawDataListProps = {
  trajectoryId: string
  points: ParsedTrajectory['points']
  replayHeadIndex: number | null
  onSeekToIndex: (index: number) => void
}

function centerRowInScrollParent(
  container: HTMLDivElement,
  row: HTMLElement,
): void {
  const cr = container.getBoundingClientRect()
  const rr = row.getBoundingClientRect()
  const rowCenter = rr.top + rr.height / 2
  const viewCenter = cr.top + cr.height / 2
  container.scrollTop += rowCenter - viewCenter
}

export const TrajectoryRawDataList = memo(function TrajectoryRawDataList({
  trajectoryId,
  points,
  replayHeadIndex,
  onSeekToIndex,
}: TrajectoryRawDataListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map())

  const indicesNewestFirst = useMemo(
    () => Array.from({ length: points.length }, (_, k) => points.length - 1 - k),
    [points.length],
  )

  /** 換檔後：先捲到頂端，讓「最新」一筆在清單上方可見 */
  useLayoutEffect(() => {
    const c = containerRef.current
    if (!c) return
    c.scrollTop = 0
  }, [trajectoryId])

  /** 播放頭變動：讓高亮列維持在捲動區垂直中央（不帶平滑，避免連續抖動） */
  useLayoutEffect(() => {
    if (replayHeadIndex === null) return
    const c = containerRef.current
    const row = rowRefs.current.get(replayHeadIndex)
    if (!c || !row) return
    centerRowInScrollParent(c, row)
  }, [replayHeadIndex, trajectoryId, points.length])

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      role="list"
      aria-label="軌跡原始數據（新到舊），點選可跳到該點"
    >
      {indicesNewestFirst.map((originalIndex) => {
        const p = points[originalIndex]
        const line = JSON.stringify({
          tMs: p.tMs,
          positionMeters: p.positionMeters,
        })
        const active = replayHeadIndex === originalIndex
        return (
          <button
            key={originalIndex}
            type="button"
            role="listitem"
            ref={(el) => {
              if (el) rowRefs.current.set(originalIndex, el)
              else rowRefs.current.delete(originalIndex)
            }}
            onClick={() => onSeekToIndex(originalIndex)}
            className={`mb-1 w-full rounded border px-1.5 py-1 text-left font-mono text-[10px] leading-snug break-all transition enabled:cursor-pointer enabled:hover:border-zinc-500 enabled:hover:bg-zinc-800/80 ${
              active
                ? 'border-amber-400/70 bg-amber-950/50 text-zinc-100'
                : 'border-zinc-700/50 bg-zinc-950/80 text-zinc-400'
            }`}
          >
            <span className="mr-1 text-zinc-500">#{originalIndex}</span>
            {line}
          </button>
        )
      })}
    </div>
  )
})
