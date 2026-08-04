import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { getFacilitySizeMeters } from '../constants/facilityDimensions'
import { domainHeightM, domainWidthM } from './areaCoords'
import { resolveFacilitySnapRectCss } from './facilityAreaCoords'
import { getValidRefFieldBounds } from './facilityRefFieldBounds'
import { fieldPointToMapPx } from './trackConnectivityScan'
import { getCrossoverPortals } from './trackCrossoverFacility'
import type { TrackNetworkSegment } from '../vehicles/trackNetwork/types'

export type CrossoverPortal = {
  trackId: string
  xM: number
  yM: number
  mapPx: { x: number; y: number }
}

/** 虛擬渡線兩端軌道之間的一條連通橋（只認軌道 id，不認上下行語意） */
export type CrossoverBridge = {
  id: string
  crossoverFacilityId: string
  trackIdA: string
  trackIdB: string
  portalA: CrossoverPortal
  portalB: CrossoverPortal
}

export function crossoverBridgeKey(trackIdA: string, trackIdB: string): string {
  return trackIdA < trackIdB ? `${trackIdA}|${trackIdB}` : `${trackIdB}|${trackIdA}`
}

function projectOntoSegmentCenterline(
  xM: number,
  yM: number,
  seg: TrackNetworkSegment,
): { xM: number; yM: number; dist: number } {
  const b = seg.bounds
  if (seg.horizontal) {
    const cy = (b.yMinM + b.yMaxM) / 2
    const cx = Math.min(b.xMaxM, Math.max(b.xMinM, xM))
    return { xM: cx, yM: cy, dist: Math.hypot(xM - cx, yM - cy) }
  }
  const cx = (b.xMinM + b.xMaxM) / 2
  const cy = Math.min(b.yMaxM, Math.max(b.yMinM, yM))
  return { xM: cx, yM: cy, dist: Math.hypot(xM - cx, yM - cy) }
}

type MapBox = { left: number; top: number; right: number; bottom: number }

function facilityMapBox(
  facility: FacilityObject,
  area: MapAreaObject,
): MapBox | null {
  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  }
  try {
    const rect = resolveFacilitySnapRectCss(
      facility,
      area.domain,
      area.layout,
      domainSpan,
    )
    return {
      left: area.layout.xPx + rect.left,
      top: area.layout.yPx + rect.top,
      right: area.layout.xPx + rect.left + rect.width,
      bottom: area.layout.yPx + rect.top + rect.height,
    }
  } catch {
    return null
  }
}

function segmentMapBox(seg: TrackNetworkSegment): MapBox {
  const area = seg.renderArea
  const domainSpan = {
    w: domainWidthM(area.domain),
    h: domainHeightM(area.domain),
  }
  const rect = resolveFacilitySnapRectCss(
    seg.track,
    area.domain,
    area.layout,
    domainSpan,
  )
  return {
    left: area.layout.xPx + rect.left,
    top: area.layout.yPx + rect.top,
    right: area.layout.xPx + rect.left + rect.width,
    bottom: area.layout.yPx + rect.top + rect.height,
  }
}

function boxesOverlap(a: MapBox, b: MapBox, slackPx: number): boolean {
  return !(
    a.right < b.left - slackPx
    || a.left > b.right + slackPx
    || a.bottom < b.top - slackPx
    || a.top > b.bottom + slackPx
  )
}

function portalOnSegmentAtMapX(
  seg: TrackNetworkSegment,
  mapX: number,
): CrossoverPortal | null {
  const box = segmentMapBox(seg)
  const t =
    box.right <= box.left
      ? 0.5
      : Math.min(1, Math.max(0, (mapX - box.left) / (box.right - box.left)))
  const b = seg.bounds
  let xM: number
  let yM: number
  if (seg.horizontal) {
    xM = b.xMinM + (b.xMaxM - b.xMinM) * t
    yM = (b.yMinM + b.yMaxM) / 2
  } else {
    xM = (b.xMinM + b.xMaxM) / 2
    yM = b.yMinM + (b.yMaxM - b.yMinM) * 0.5
  }
  const mapPx = fieldPointToMapPx(xM, yM, seg)
  if (!mapPx) return null
  return { trackId: seg.trackId, xM, yM, mapPx }
}

function snapCornerToTrack(
  xM: number,
  yM: number,
  segmentById: Map<string, TrackNetworkSegment>,
  maxDistM: number,
): CrossoverPortal | null {
  let best: CrossoverPortal | null = null
  let bestDist = Infinity
  for (const seg of segmentById.values()) {
    const projected = projectOntoSegmentCenterline(xM, yM, seg)
    if (projected.dist > maxDistM || projected.dist >= bestDist) continue
    const mapPx = fieldPointToMapPx(projected.xM, projected.yM, seg)
    if (!mapPx) continue
    bestDist = projected.dist
    best = {
      trackId: seg.trackId,
      xM: projected.xM,
      yM: projected.yM,
      mapPx,
    }
  }
  return best
}

function crossoverFieldBounds(
  facility: FacilityObject,
): { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number } | null {
  const ref = getValidRefFieldBounds(facility.parameters)
  if (ref) return ref
  const size = getFacilitySizeMeters(facility)
  const x0 = facility.position.x
  const y0 = facility.position.y
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null
  return {
    xMinM: x0,
    yMinM: y0,
    xMaxM: x0 + size.w,
    yMaxM: y0 + size.h,
  }
}

function makeBridge(
  crossoverFacilityId: string,
  portalA: CrossoverPortal,
  portalB: CrossoverPortal,
  suffix: string,
): CrossoverBridge | null {
  if (portalA.trackId === portalB.trackId) return null
  return {
    id: `${crossoverFacilityId}:${suffix}`,
    crossoverFacilityId,
    trackIdA: portalA.trackId,
    trackIdB: portalB.trackId,
    portalA,
    portalB,
  }
}

function pushUniqueBridges(
  bridges: CrossoverBridge[],
  seen: Set<string>,
  facilityId: string,
  candidates: Array<CrossoverBridge | null>,
) {
  for (const bridge of candidates) {
    if (!bridge) continue
    const key = crossoverBridgeKey(bridge.trackIdA, bridge.trackIdB)
    const dedupe = `${facilityId}:${key}:${bridge.portalA.xM.toFixed(2)}:${bridge.portalB.xM.toFixed(2)}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    bridges.push(bridge)
  }
}

function overlapScoreAlongX(xoBox: MapBox, seg: TrackNetworkSegment): number {
  const b = segmentMapBox(seg)
  return Math.min(xoBox.right, b.right) - Math.max(xoBox.left, b.left)
}

/** 後備：在鄰近軌道中挑兩條幾何重疊最高、且 id 不同的軌，不看別名語意 */
function pickTwoNearestDistinctTracks(
  near: TrackNetworkSegment[],
  xoBox: MapBox,
): [TrackNetworkSegment, TrackNetworkSegment] | null {
  if (near.length < 2) return null
  const ranked = [...near].sort(
    (a, b) => overlapScoreAlongX(xoBox, b) - overlapScoreAlongX(xoBox, a),
  )
  const first = ranked[0]!
  const second = ranked.find((s) => s.trackId !== first.trackId)
  if (!second) return null
  return [first, second]
}

/** 後備：從角落吸附點中挑兩條不同軌道、距離最遠的一對 */
function pickFarthestDistinctPortalPair(
  portals: CrossoverPortal[],
): [CrossoverPortal, CrossoverPortal] | null {
  let best: [CrossoverPortal, CrossoverPortal] | null = null
  let bestDist = -1
  for (let i = 0; i < portals.length; i++) {
    for (let j = i + 1; j < portals.length; j++) {
      const a = portals[i]!
      const b = portals[j]!
      if (a.trackId === b.trackId) continue
      const dist = Math.hypot(a.xM - b.xM, a.yM - b.yM)
      if (dist > bestDist) {
        bestDist = dist
        best = [a, b]
      }
    }
  }
  return best
}

/**
 * 從地圖上的 TrackCrossover 推導兩端軌道連通橋。
 * 優先使用端點已接合的 attachedTrackId；否則僅依幾何鄰近推斷。
 * 不依軌道別名的上下行／U／D 語意。
 */
export function collectCrossoverBridges(
  areas: MapAreaObject[],
  segmentById: Map<string, TrackNetworkSegment>,
): CrossoverBridge[] {
  const bridges: CrossoverBridge[] = []
  const seen = new Set<string>()
  const segments = [...segmentById.values()]

  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'TrackCrossover') continue

      const stored = getCrossoverPortals(facility)
      if (stored) {
        const a = stored.a
        const b = stored.b
        if (
          a.attachedTrackId
          && b.attachedTrackId
          && a.attachedTrackId !== b.attachedTrackId
        ) {
          const segA = segmentById.get(a.attachedTrackId)
          const segB = segmentById.get(b.attachedTrackId)
          if (segA && segB) {
            const mapA = fieldPointToMapPx(a.xM, a.yM, segA)
            const mapB = fieldPointToMapPx(b.xM, b.yM, segB)
            if (mapA && mapB) {
              pushUniqueBridges(bridges, seen, facility.id, [
                makeBridge(
                  facility.id,
                  {
                    trackId: a.attachedTrackId,
                    xM: a.xM,
                    yM: a.yM,
                    mapPx: mapA,
                  },
                  {
                    trackId: b.attachedTrackId,
                    xM: b.xM,
                    yM: b.yM,
                    mapPx: mapB,
                  },
                  'a-b',
                ),
              ])
              continue
            }
          }
        }
      }

      const xoBox = facilityMapBox(facility, area)
      let builtFromMap = false

      if (xoBox) {
        const near = segments.filter((seg) =>
          boxesOverlap(xoBox, segmentMapBox(seg), 28),
        )
        const pair = pickTwoNearestDistinctTracks(near, xoBox)
        if (pair) {
          const [segA, segB] = pair
          const leftX = xoBox.left + (xoBox.right - xoBox.left) * 0.18
          const rightX = xoBox.left + (xoBox.right - xoBox.left) * 0.82
          const portalA = portalOnSegmentAtMapX(segA, leftX)
          const portalB = portalOnSegmentAtMapX(segB, rightX)
          if (portalA && portalB) {
            pushUniqueBridges(bridges, seen, facility.id, [
              makeBridge(facility.id, portalA, portalB, 'leg'),
            ])
            builtFromMap = true
          }
        }
      }

      if (builtFromMap) continue

      const bounds = crossoverFieldBounds(facility)
      if (!bounds) continue

      const corners = [
        { xM: bounds.xMinM, yM: bounds.yMaxM },
        { xM: bounds.xMaxM, yM: bounds.yMaxM },
        { xM: bounds.xMinM, yM: bounds.yMinM },
        { xM: bounds.xMaxM, yM: bounds.yMinM },
      ]
      const span = Math.hypot(
        bounds.xMaxM - bounds.xMinM,
        bounds.yMaxM - bounds.yMinM,
      )
      const maxDist = Math.max(12, span * 0.85)

      const portals = corners
        .map((c) => snapCornerToTrack(c.xM, c.yM, segmentById, maxDist))
        .filter((p): p is CrossoverPortal => p != null)

      const pair = pickFarthestDistinctPortalPair(portals)
      if (!pair) continue

      pushUniqueBridges(bridges, seen, facility.id, [
        makeBridge(facility.id, pair[0], pair[1], 'leg'),
      ])
    }
  }

  return bridges
}

export function indexCrossoverBridges(
  bridges: CrossoverBridge[],
): Map<string, CrossoverBridge[]> {
  const map = new Map<string, CrossoverBridge[]>()
  for (const bridge of bridges) {
    const key = crossoverBridgeKey(bridge.trackIdA, bridge.trackIdB)
    const list = map.get(key) ?? []
    list.push(bridge)
    map.set(key, list)
  }
  return map
}

/** 把渡線橋加入鄰接圖（不修改原 map） */
export function adjWithCrossoverBridges(
  adj: Map<string, Set<string>>,
  bridges: CrossoverBridge[],
): Map<string, Set<string>> {
  const next = new Map<string, Set<string>>()
  for (const [id, set] of adj) {
    next.set(id, new Set(set))
  }
  for (const bridge of bridges) {
    if (!next.has(bridge.trackIdA)) next.set(bridge.trackIdA, new Set())
    if (!next.has(bridge.trackIdB)) next.set(bridge.trackIdB, new Set())
    next.get(bridge.trackIdA)!.add(bridge.trackIdB)
    next.get(bridge.trackIdB)!.add(bridge.trackIdA)
  }
  return next
}

type ScanPathPointLite = {
  xM: number
  yM: number
  trackId: string
  mapPx: { x: number; y: number }
}

function sampleBridgePath(
  from: CrossoverPortal,
  to: CrossoverPortal,
  steps = 10,
): ScanPathPointLite[] {
  const out: ScanPathPointLite[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push({
      xM: from.xM + (to.xM - from.xM) * t,
      yM: from.yM + (to.yM - from.yM) * t,
      trackId: from.trackId,
      mapPx: {
        x: from.mapPx.x + (to.mapPx.x - from.mapPx.x) * t,
        y: from.mapPx.y + (to.mapPx.y - from.mapPx.y) * t,
      },
    })
  }
  return out
}

function orientBridge(
  bridge: CrossoverBridge,
  fromTrackId: string,
): { from: CrossoverPortal; to: CrossoverPortal } {
  if (bridge.trackIdA === fromTrackId) {
    return { from: bridge.portalA, to: bridge.portalB }
  }
  if (bridge.trackIdB === fromTrackId) {
    return { from: bridge.portalB, to: bridge.portalA }
  }
  return { from: bridge.portalA, to: bridge.portalB }
}

function pickBridge(
  bridgesByKey: Map<string, CrossoverBridge[]>,
  trackIdA: string,
  trackIdB: string,
): CrossoverBridge | null {
  const list = bridgesByKey.get(crossoverBridgeKey(trackIdA, trackIdB))
  if (!list || list.length === 0) return null
  return list[0]!
}

function appendScanPoints(
  target: ScanPathPointLite[],
  segment: ScanPathPointLite[],
) {
  for (const p of segment) {
    const last = target[target.length - 1]
    if (
      last
      && Math.hypot(last.mapPx.x - p.mapPx.x, last.mapPx.y - p.mapPx.y) < 0.5
    ) {
      continue
    }
    target.push(p)
  }
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

/**
 * 沿軌道 id 鏈建路徑；若相鄰兩段僅靠渡線相通，插入對角道路採樣點。
 */
export function buildRoutingPathWithCrossovers(
  orderedTrackIds: string[],
  segmentById: Map<string, TrackNetworkSegment>,
  bridgesByKey: Map<string, CrossoverBridge[]>,
  buildContinuousChain: (
    ids: string[],
    segmentById: Map<string, TrackNetworkSegment>,
  ) => ScanPathPointLite[],
): ScanPathPointLite[] {
  if (orderedTrackIds.length === 0) return []
  if (orderedTrackIds.length === 1) {
    return buildContinuousChain(orderedTrackIds, segmentById)
  }

  const out: ScanPathPointLite[] = []
  let runStart = 0

  for (let i = 0; i < orderedTrackIds.length - 1; i++) {
    const a = orderedTrackIds[i]!
    const b = orderedTrackIds[i + 1]!
    const bridge = pickBridge(bridgesByKey, a, b)
    if (!bridge) continue

    const runIds = orderedTrackIds.slice(runStart, i + 1)
    if (runIds.length > 0) {
      appendScanPoints(out, buildContinuousChain(runIds, segmentById))
    }

    const { from, to } = orientBridge(bridge, a)
    if (out.length > 0) {
      appendScanPoints(out, [
        {
          xM: from.xM,
          yM: from.yM,
          trackId: from.trackId,
          mapPx: { ...from.mapPx },
        },
      ])
    }
    appendScanPoints(out, sampleBridgePath(from, to))
    runStart = i + 1
  }

  const rest = orderedTrackIds.slice(runStart)
  if (rest.length > 0) {
    appendScanPoints(out, buildContinuousChain(rest, segmentById))
  }
  return out
}

/**
 * 起迄吸附點之間的軌道路徑（可含渡線橋）。
 * 渡線前後各自在實體軌道 run 上切片，再串橋，避免橋後整段重採樣造成「跳到軌道另一端再折回」的亂線。
 */
export function buildMapPathBetweenTrackSnaps(
  orderedTrackIds: string[],
  segmentById: Map<string, TrackNetworkSegment>,
  bridgesByKey: Map<string, CrossoverBridge[]>,
  from: { xM: number; yM: number; mapPx: { x: number; y: number } },
  to: { xM: number; yM: number; mapPx: { x: number; y: number } },
  buildContinuousChain: (
    ids: string[],
    segmentById: Map<string, TrackNetworkSegment>,
  ) => ScanPathPointLite[],
): Array<{ x: number; y: number }> | null {
  if (orderedTrackIds.length === 0) return null

  if (orderedTrackIds.length === 1) {
    const chain = buildContinuousChain(orderedTrackIds, segmentById)
    return sliceChainMapPx(chain, from, to)
  }

  const out: Array<{ x: number; y: number }> = []
  let cursor = { xM: from.xM, yM: from.yM, mapPx: { ...from.mapPx } }
  let runStart = 0

  const appendPx = (pts: Array<{ x: number; y: number }> | null) => {
    if (!pts || pts.length === 0) return
    for (const p of pts) {
      const last = out[out.length - 1]
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.5) continue
      out.push(p)
    }
  }

  for (let i = 0; i < orderedTrackIds.length - 1; i++) {
    const a = orderedTrackIds[i]!
    const b = orderedTrackIds[i + 1]!
    const bridge = pickBridge(bridgesByKey, a, b)
    if (!bridge) continue

    const runIds = orderedTrackIds.slice(runStart, i + 1)
    const { from: portalFrom, to: portalTo } = orientBridge(bridge, a)
    if (runIds.length > 0) {
      const chain = buildContinuousChain(runIds, segmentById)
      appendPx(sliceChainMapPx(chain, cursor, portalFrom))
    }
    appendPx(sampleBridgePath(portalFrom, portalTo).map((p) => ({ ...p.mapPx })))
    cursor = {
      xM: portalTo.xM,
      yM: portalTo.yM,
      mapPx: { ...portalTo.mapPx },
    }
    runStart = i + 1
  }

  const rest = orderedTrackIds.slice(runStart)
  if (rest.length > 0) {
    const chain = buildContinuousChain(rest, segmentById)
    appendPx(sliceChainMapPx(chain, cursor, to))
  } else {
    appendPx([to.mapPx])
  }

  return out.length >= 2 ? out : null
}
