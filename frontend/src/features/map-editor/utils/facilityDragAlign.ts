/** Area 內設施拖曳用的矩形（CSS 左上原點，單位 px） */
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import { resolveFacilitySnapRectCss } from './facilityAreaCoords'

export type SnapRect = {
  left: number
  top: number
  width: number
  height: number
}

export type AlignGuideLine = {
  axis: 'x' | 'y'
  /** 線在 area 內的像素位置（垂直線為 x，水平線為 y） */
  at: number
  from: number
  to: number
}

/** 磁吸距離（px，Area 內局部座標）；略大較易對齊，仍維持精準貼齊 */
export const FACILITY_ALIGN_SNAP_PX = 5

const DEFAULT_SNAP_PX = FACILITY_ALIGN_SNAP_PX

/** 依地圖縮放補償磁吸半徑（縮小地圖時略放寬，放大時維持精準） */
export function resolveFacilityAlignSnapThresholdPx(mapScale = 1): number {
  return Math.max(3, FACILITY_ALIGN_SNAP_PX / Math.max(0.15, mapScale))
}

/** 對齊線與邊緣視為「重合」的容差（px） */
const ALIGN_GUIDE_EPS = 0.25

function roundAlignPx(v: number): number {
  return Math.round(v * 100) / 100
}

type EdgeSet = {
  left: number
  right: number
  cx: number
  top: number
  bottom: number
  cy: number
}

function edges(r: SnapRect): EdgeSet {
  return {
    left: r.left,
    right: r.left + r.width,
    cx: r.left + r.width / 2,
    top: r.top,
    bottom: r.top + r.height,
    cy: r.top + r.height / 2,
  }
}

type SnapCandidate = { value: number; kind: 'left' | 'right' | 'cx' | 'top' | 'bottom' | 'cy' }

function collectCandidates(
  rects: SnapRect[],
  bounds: SnapRect,
): { x: SnapCandidate[]; y: SnapCandidate[] } {
  const x: SnapCandidate[] = [
    { value: bounds.left, kind: 'left' },
    { value: bounds.left + bounds.width / 2, kind: 'cx' },
    { value: bounds.left + bounds.width, kind: 'right' },
  ]
  const y: SnapCandidate[] = [
    { value: bounds.top, kind: 'top' },
    { value: bounds.top + bounds.height / 2, kind: 'cy' },
    { value: bounds.top + bounds.height, kind: 'bottom' },
  ]
  for (const r of rects) {
    const e = edges(r)
    x.push(
      { value: e.left, kind: 'left' },
      { value: e.cx, kind: 'cx' },
      { value: e.right, kind: 'right' },
    )
    y.push(
      { value: e.top, kind: 'top' },
      { value: e.cy, kind: 'cy' },
      { value: e.bottom, kind: 'bottom' },
    )
  }
  return { x, y }
}

type AxisSnap = {
  delta: number
  guideAt: number
  guideFrom: number
  guideTo: number
}

function bestAxisSnap(
  moving: EdgeSet,
  candidates: SnapCandidate[],
  axis: 'x' | 'y',
  peerRects: SnapRect[],
  bounds: SnapRect,
  threshold: number,
): AxisSnap | null {
  const movingEdges =
    axis === 'x'
      ? [
          { value: moving.left, kind: 'left' as const },
          { value: moving.cx, kind: 'cx' as const },
          { value: moving.right, kind: 'right' as const },
        ]
      : [
          { value: moving.top, kind: 'top' as const },
          { value: moving.cy, kind: 'cy' as const },
          { value: moving.bottom, kind: 'bottom' as const },
        ]

  let best: { delta: number; target: number; kind: SnapCandidate['kind'] } | null =
    null

  for (const me of movingEdges) {
    for (const c of candidates) {
      const delta = c.value - me.value
      if (Math.abs(delta) > threshold) continue
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, target: c.value, kind: c.kind }
      }
    }
  }

  if (!best) return null

  const guideAt = roundAlignPx(best.target)
  const alignEps = ALIGN_GUIDE_EPS
  let guideFrom: number
  let guideTo: number
  if (axis === 'x') {
    guideFrom = bounds.top
    guideTo = bounds.top + bounds.height
    for (const r of peerRects) {
      const e = edges(r)
      if (Math.abs(e.left - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.top)
        guideTo = Math.max(guideTo, e.bottom)
      }
      if (Math.abs(e.cx - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.top)
        guideTo = Math.max(guideTo, e.bottom)
      }
      if (Math.abs(e.right - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.top)
        guideTo = Math.max(guideTo, e.bottom)
      }
    }
    const me = edges({
      left: roundAlignPx(moving.left + best.delta),
      top: moving.top,
      width: moving.right - moving.left,
      height: moving.bottom - moving.top,
    })
    guideFrom = Math.min(guideFrom, me.top)
    guideTo = Math.max(guideTo, me.bottom)
  } else {
    guideFrom = bounds.left
    guideTo = bounds.left + bounds.width
    for (const r of peerRects) {
      const e = edges(r)
      if (Math.abs(e.top - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.left)
        guideTo = Math.max(guideTo, e.right)
      }
      if (Math.abs(e.cy - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.left)
        guideTo = Math.max(guideTo, e.right)
      }
      if (Math.abs(e.bottom - guideAt) < alignEps) {
        guideFrom = Math.min(guideFrom, e.left)
        guideTo = Math.max(guideTo, e.right)
      }
    }
    const me = edges({
      left: moving.left,
      top: roundAlignPx(moving.top + best.delta),
      width: moving.right - moving.left,
      height: moving.bottom - moving.top,
    })
    guideFrom = Math.min(guideFrom, me.left)
    guideTo = Math.max(guideTo, me.right)
  }

  return {
    delta: roundAlignPx(best.delta),
    guideAt,
    guideFrom: roundAlignPx(guideFrom),
    guideTo: roundAlignPx(guideTo),
  }
}

/**
 * 拖曳時對齊同 Area 與其他 Area 內設施邊／中心與 Area 外框，並回傳對齊輔助線。
 */
export function snapDragRectWithAlignGuides(
  moving: SnapRect,
  peers: SnapRect[],
  areaBounds: SnapRect,
  thresholdPx = DEFAULT_SNAP_PX,
): { rect: SnapRect; guides: AlignGuideLine[] } {
  const me = edges(moving)
  const { x: xCands, y: yCands } = collectCandidates(peers, areaBounds)

  const snapX = bestAxisSnap(me, xCands, 'x', peers, areaBounds, thresholdPx)
  const snapY = bestAxisSnap(me, yCands, 'y', peers, areaBounds, thresholdPx)

  const rect: SnapRect = {
    ...moving,
    left: roundAlignPx(moving.left + (snapX?.delta ?? 0)),
    top: roundAlignPx(moving.top + (snapY?.delta ?? 0)),
  }

  const guides: AlignGuideLine[] = []
  if (snapX) {
    guides.push({
      axis: 'x',
      at: snapX.guideAt,
      from: snapX.guideFrom,
      to: snapX.guideTo,
    })
  }
  if (snapY) {
    guides.push({
      axis: 'y',
      at: snapY.guideAt,
      from: snapY.guideFrom,
      to: snapY.guideTo,
    })
  }

  return { rect, guides }
}

function domainSpanForArea(area: MapAreaObject) {
  const { domain } = area
  return { w: domain.xMaxM - domain.xMinM, h: domain.yMaxM - domain.yMinM }
}

/** 設施在 Area 內 CSS 矩形（左上原點） */
export function facilitySnapRectInAreaLocal(
  fac: FacilityObject,
  area: MapAreaObject,
): SnapRect {
  const rect = resolveFacilitySnapRectCss(
    fac,
    area.domain,
    area.layout,
    domainSpanForArea(area),
  )
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

/** 設施在整張地圖畫布上的 CSS 矩形 */
export function facilitySnapRectOnMapCanvas(
  fac: FacilityObject,
  area: MapAreaObject,
): SnapRect {
  const local = facilitySnapRectInAreaLocal(fac, area)
  return {
    left: area.layout.xPx + local.left,
    top: area.layout.yPx + local.top,
    width: local.width,
    height: local.height,
  }
}

/** 地圖畫布座標 → 指定 Area 內局部座標 */
export function snapRectFromMapCanvasToAreaLocal(
  rect: SnapRect,
  area: MapAreaObject,
): SnapRect {
  return {
    left: rect.left - area.layout.xPx,
    top: rect.top - area.layout.yPx,
    width: rect.width,
    height: rect.height,
  }
}

/** 其他 Area 內所有設施，換算成 host Area 內的對齊矩形 */
export function buildCrossAreaPeerSnapRects(
  allAreas: MapAreaObject[],
  hostAreaId: string,
): SnapRect[] {
  const host = allAreas.find((a) => a.id === hostAreaId)
  if (!host) return []
  const out: SnapRect[] = []
  for (const area of allAreas) {
    if (area.id === hostAreaId) continue
    for (const fac of area.facilities) {
      out.push(
        snapRectFromMapCanvasToAreaLocal(
          facilitySnapRectOnMapCanvas(fac, area),
          host,
        ),
      )
    }
  }
  return out
}

export type ResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'topLeft'

function affectsLeft(dir: ResizeDirection) {
  return dir === 'left' || dir === 'topLeft' || dir === 'bottomLeft'
}

function affectsRight(dir: ResizeDirection) {
  return dir === 'right' || dir === 'topRight' || dir === 'bottomRight'
}

function affectsTop(dir: ResizeDirection) {
  return dir === 'top' || dir === 'topLeft' || dir === 'topRight'
}

function affectsBottom(dir: ResizeDirection) {
  return dir === 'bottom' || dir === 'bottomLeft' || dir === 'bottomRight'
}

function buildGuideSpan(
  guideAt: number,
  axis: 'x' | 'y',
  peerRects: SnapRect[],
  bounds: SnapRect,
  moving: SnapRect,
  _threshold: number,
): { from: number; to: number } {
  const alignEps = ALIGN_GUIDE_EPS
  if (axis === 'x') {
    let guideFrom = bounds.top
    let guideTo = bounds.top + bounds.height
    for (const r of peerRects) {
      const e = edges(r)
      if (
        Math.abs(e.left - guideAt) < alignEps
        || Math.abs(e.cx - guideAt) < alignEps
        || Math.abs(e.right - guideAt) < alignEps
      ) {
        guideFrom = Math.min(guideFrom, e.top)
        guideTo = Math.max(guideTo, e.bottom)
      }
    }
    const me = edges(moving)
    guideFrom = Math.min(guideFrom, me.top)
    guideTo = Math.max(guideTo, me.bottom)
    return { from: roundAlignPx(guideFrom), to: roundAlignPx(guideTo) }
  }

  let guideFrom = bounds.left
  let guideTo = bounds.left + bounds.width
  for (const r of peerRects) {
    const e = edges(r)
    if (
      Math.abs(e.top - guideAt) < alignEps
      || Math.abs(e.cy - guideAt) < alignEps
      || Math.abs(e.bottom - guideAt) < alignEps
    ) {
      guideFrom = Math.min(guideFrom, e.left)
      guideTo = Math.max(guideTo, e.right)
    }
  }
  const me = edges(moving)
  guideFrom = Math.min(guideFrom, me.left)
  guideTo = Math.max(guideTo, me.right)
  return { from: roundAlignPx(guideFrom), to: roundAlignPx(guideTo) }
}

function snapEdgeValue(
  edgeValue: number,
  candidates: SnapCandidate[],
  threshold: number,
): { delta: number; guideAt: number } | null {
  let best: { delta: number; target: number } | null = null
  for (const c of candidates) {
    const delta = c.value - edgeValue
    if (Math.abs(delta) > threshold) continue
    if (!best || Math.abs(delta) < Math.abs(best.delta)) {
      best = { delta, target: c.value }
    }
  }
  if (!best) return null
  return { delta: roundAlignPx(best.delta), guideAt: roundAlignPx(best.target) }
}

/**
 * 縮放時對齊同層其他矩形邊／中心與容器外框（僅調整正在拖動的邊）。
 */
export function snapResizeRectWithAlignGuides(
  moving: SnapRect,
  direction: ResizeDirection,
  peers: SnapRect[],
  areaBounds: SnapRect,
  thresholdPx = DEFAULT_SNAP_PX,
  minSize: { width: number; height: number } = { width: 10, height: 10 },
): { rect: SnapRect; guides: AlignGuideLine[] } {
  const { x: xCands, y: yCands } = collectCandidates(peers, areaBounds)
  const guides: AlignGuideLine[] = []
  let rect: SnapRect = { ...moving }

  if (affectsLeft(direction)) {
    const snap = snapEdgeValue(rect.left, xCands, thresholdPx)
    if (snap) {
      const nextLeft = rect.left + snap.delta
      const nextWidth = rect.width - snap.delta
      if (nextWidth >= minSize.width) {
        rect.left = nextLeft
        rect.width = nextWidth
        const span = buildGuideSpan(snap.guideAt, 'x', peers, areaBounds, rect, thresholdPx)
        guides.push({ axis: 'x', at: snap.guideAt, from: span.from, to: span.to })
      }
    }
  }

  if (affectsRight(direction)) {
    const right = rect.left + rect.width
    const snap = snapEdgeValue(right, xCands, thresholdPx)
    if (snap) {
      const nextWidth = rect.width + snap.delta
      if (nextWidth >= minSize.width) {
        rect.width = nextWidth
        const span = buildGuideSpan(snap.guideAt, 'x', peers, areaBounds, rect, thresholdPx)
        guides.push({ axis: 'x', at: snap.guideAt, from: span.from, to: span.to })
      }
    }
  }

  if (affectsTop(direction)) {
    const snap = snapEdgeValue(rect.top, yCands, thresholdPx)
    if (snap) {
      const nextTop = rect.top + snap.delta
      const nextHeight = rect.height - snap.delta
      if (nextHeight >= minSize.height) {
        rect.top = nextTop
        rect.height = nextHeight
        const span = buildGuideSpan(snap.guideAt, 'y', peers, areaBounds, rect, thresholdPx)
        guides.push({ axis: 'y', at: snap.guideAt, from: span.from, to: span.to })
      }
    }
  }

  if (affectsBottom(direction)) {
    const bottom = rect.top + rect.height
    const snap = snapEdgeValue(bottom, yCands, thresholdPx)
    if (snap) {
      const nextHeight = rect.height + snap.delta
      if (nextHeight >= minSize.height) {
        rect.height = nextHeight
        const span = buildGuideSpan(snap.guideAt, 'y', peers, areaBounds, rect, thresholdPx)
        guides.push({ axis: 'y', at: snap.guideAt, from: span.from, to: span.to })
      }
    }
  }

  return { rect, guides }
}
