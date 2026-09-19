import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'

/**
 * 起迄吸附點之間的軌道路徑：沿相鄰軌道串成一條連續鏈，再切出從起點到終點的那一段。
 */

type ScanPathPointLite = {
  xM: number
  yM: number
  trackId: string
  mapPx: { x: number; y: number }
}

function sliceChainMapPx(
  chain: ScanPathPointLite[],
  from: { xM: number; yM: number },
  to: { xM: number; yM: number },
): Array<{ x: number; y: number }> | null {
  if (chain.length < 1) return null
  let i0 = 0
  let i1 = 0
  let best0 = Infinity
  let best1 = Infinity
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i]!
    const d0 = Math.hypot(p.xM - from.xM, p.yM - from.yM)
    const d1 = Math.hypot(p.xM - to.xM, p.yM - to.yM)
    if (d0 < best0) {
      best0 = d0
      i0 = i
    }
    if (d1 < best1) {
      best1 = d1
      i1 = i
    }
  }
  const sliced =
    i0 <= i1
      ? chain.slice(i0, i1 + 1)
      : chain.slice(i1, i0 + 1).reverse()
  const mapPx = sliced.map((p) => ({ ...p.mapPx }))
  return mapPx.length >= 1 ? mapPx : null
}

export function buildMapPathBetweenTrackSnaps(
  orderedTrackIds: string[],
  segmentById: Map<string, TrackNetworkSegment>,
  from: { xM: number; yM: number },
  to: { xM: number; yM: number },
  buildContinuousChain: (
    ids: string[],
    segmentById: Map<string, TrackNetworkSegment>,
  ) => ScanPathPointLite[],
): Array<{ x: number; y: number }> | null {
  if (orderedTrackIds.length === 0) return null
  const chain = buildContinuousChain(orderedTrackIds, segmentById)
  const sliced = sliceChainMapPx(chain, from, to)
  if (!sliced) return null
  if (orderedTrackIds.length === 1) return sliced

  // 多段時相鄰重複的點（0.5 px 內）併掉，少於兩點視為串不起來
  const out: Array<{ x: number; y: number }> = []
  for (const p of sliced) {
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.5) continue
    out.push(p)
  }
  return out.length >= 2 ? out : null
}
