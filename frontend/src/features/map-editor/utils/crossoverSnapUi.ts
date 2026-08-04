import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'
import {
  CROSSOVER_ATTACH_SNAP_M,
  CROSSOVER_HOOK_PREVIEW_M,
  projectPointOntoTrackSegment,
  type CrossoverHookTarget,
  type CrossoverPortalKey,
} from '../utils/trackCrossoverFacility'

/** Area 層級：鄰近軌道標示 + 勾子疊層 */
export type CrossoverSnapUi = {
  nearbyTrackIds: string[]
  hooks: Array<
    CrossoverHookTarget & {
      fromPortalKey: CrossoverPortalKey
      fromXM: number
      fromYM: number
    }
  >
}

/**
 * 列出預覽距離內所有鄰近軌道（先標示候選，再對最近者顯示勾子）。
 */
export function listNearbyCrossoverTracks(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
  maxDistM = CROSSOVER_HOOK_PREVIEW_M,
): Array<{
  trackId: string
  xM: number
  yM: number
  dist: number
  horizontal: boolean
}> {
  const bestByTrack = new Map<
    string,
    { trackId: string; xM: number; yM: number; dist: number; horizontal: boolean }
  >()
  for (const seg of segmentById.values()) {
    const p = projectPointOntoTrackSegment(xM, yM, seg)
    if (p.dist > maxDistM) continue
    const prev = bestByTrack.get(seg.trackId)
    if (!prev || p.dist < prev.dist) {
      bestByTrack.set(seg.trackId, {
        trackId: seg.trackId,
        xM: p.xM,
        yM: p.yM,
        dist: p.dist,
        horizontal: seg.horizontal,
      })
    }
  }
  return [...bestByTrack.values()].sort((a, b) => a.dist - b.dist)
}

export function buildCrossoverSnapUiForPoint(
  xM: number,
  yM: number,
  fromPortalKey: CrossoverPortalKey,
  segmentById: Map<string, TrackNetworkSegment>,
  attachedTrackId: string | null,
): CrossoverSnapUi | null {
  const nearby = listNearbyCrossoverTracks(xM, yM, segmentById)
  if (nearby.length === 0 && !attachedTrackId) return null

  const nearbyTrackIds = [
    ...new Set([
      ...nearby.map((n) => n.trackId),
      ...(attachedTrackId ? [attachedTrackId] : []),
    ]),
  ]

  let hook: CrossoverHookTarget | null = null
  const nearest = nearby[0] ?? null
  // 勾子優先指向「即將／正在接合」的最近軌；已接合但旁軌更近時也指向旁軌
  const hookSrc =
    nearest &&
    (!attachedTrackId ||
      nearest.trackId !== attachedTrackId ||
      nearest.dist <= CROSSOVER_ATTACH_SNAP_M)
      ? nearest
      : attachedTrackId
        ? (() => {
            const seg = segmentById.get(attachedTrackId)
            if (!seg) return null
            const p = projectPointOntoTrackSegment(xM, yM, seg)
            return {
              trackId: attachedTrackId,
              xM: p.xM,
              yM: p.yM,
              dist: p.dist,
              horizontal: seg.horizontal,
            }
          })()
        : null

  if (hookSrc) {
    const openNy = hookSrc.horizontal ? Math.sign(yM - hookSrc.yM) || 1 : 0
    const openNx = hookSrc.horizontal ? 0 : Math.sign(xM - hookSrc.xM) || 1
    hook = {
      trackId: hookSrc.trackId,
      xM: hookSrc.xM,
      yM: hookSrc.yM,
      dist: hookSrc.dist,
      horizontal: hookSrc.horizontal,
      openNx,
      openNy,
      engaged:
        attachedTrackId === hookSrc.trackId ||
        hookSrc.dist <= CROSSOVER_ATTACH_SNAP_M,
    }
  }

  if (nearbyTrackIds.length === 0) return null

  return {
    nearbyTrackIds,
    hooks: hook
      ? [
          {
            ...hook,
            fromPortalKey,
            fromXM: xM,
            fromYM: yM,
          },
        ]
      : [],
  }
}

export function mergeCrossoverSnapUi(
  parts: Array<CrossoverSnapUi | null>,
): CrossoverSnapUi | null {
  const ids = new Set<string>()
  const hooks: CrossoverSnapUi['hooks'] = []
  for (const p of parts) {
    if (!p) continue
    for (const id of p.nearbyTrackIds) ids.add(id)
    hooks.push(...p.hooks)
  }
  if (ids.size === 0 && hooks.length === 0) return null
  return { nearbyTrackIds: [...ids], hooks }
}
