import { memo, useId, useMemo } from 'react'
import type { MapAreaObject } from '../types/area'
import type { MapPlannedRoute } from '../types/mapFile'
import type { PointTopology } from '../types/pointTopology'
import { resolveRoutePreviewGeometry } from '../utils/routeTrackPath'
import {
  formatRouteTravelTimeSummary,
  resolveRoutePathMidpointPx,
  type RouteStationPoint,
} from '../utils/routePlanning'
import { geometryFromPathWaypoints } from '../utils/simRoutePathEdit'

type RoutePreview = {
  stationIds: string[]
  color: string
  label?: string
  emphasized?: boolean
  avgTravelTimeSeconds?: number | null
  minTravelTimeSeconds?: number | null
}

type RoutePlanningOverlayProps = {
  areas: MapAreaObject[]
  pointTopology?: PointTopology | null
  activePreview: RoutePreview | null
  savedRoutes?: Array<{
    route: MapPlannedRoute
    color: string
    emphasized?: boolean
  }>
}

const SAVED_ROUTE_COLORS = [
  'rgba(56, 189, 248, 0.9)',
  'rgba(167, 139, 250, 0.9)',
  'rgba(52, 211, 153, 0.9)',
  'rgba(251, 191, 36, 0.9)',
  'rgba(244, 114, 182, 0.9)',
]

export function routeColorForIndex(index: number): string {
  return SAVED_ROUTE_COLORS[index % SAVED_ROUTE_COLORS.length]!
}

type PathArrow = { x: number; y: number; angleDeg: number }

function samplePathDirectionArrows(
  path: Array<{ x: number; y: number }>,
  spacingPx: number,
): PathArrow[] {
  if (path.length < 2) return []

  const cumLen: number[] = [0]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    cumLen.push(cumLen[i]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const totalLen = cumLen[cumLen.length - 1]!
  if (totalLen < 16) return []

  const out: PathArrow[] = []
  const tailMargin = 22
  let d = spacingPx * 0.4
  while (d < totalLen - tailMargin) {
    let segIdx = 0
    while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1]! < d) segIdx++
    const segStart = cumLen[segIdx]!
    const segEnd = cumLen[segIdx + 1]!
    const segLen = segEnd - segStart
    if (segLen > 0.001) {
      const t = (d - segStart) / segLen
      const a = path[segIdx]!
      const b = path[segIdx + 1]!
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      })
    }
    d += spacingPx
  }
  return out
}

function DirectionChevron({
  x,
  y,
  angleDeg,
  color,
  size = 1,
}: {
  x: number
  y: number
  angleDeg: number
  color: string
  size?: number
}) {
  const s = size
  return (
    <path
      d={`M ${-5 * s} ${-2.5 * s} L ${-1.5 * s} 0 L ${-5 * s} ${2.5 * s}`}
      transform={`translate(${x} ${y}) rotate(${angleDeg})`}
      fill="none"
      stroke={color}
      strokeWidth={1.25 * s}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.92}
    />
  )
}

function RouteTravelTimeLabel({
  x,
  y,
  label,
  routeName,
  color,
}: {
  x: number
  y: number
  label: string
  routeName?: string
  color: string
}) {
  const title = routeName ? `${routeName} · ${label}` : label
  const line1 = routeName?.trim() || label
  const line2 = routeName?.trim() ? label : null
  const textLines = line2 ? [line1, line2] : [line1]
  const padX = 8
  const padY = 5
  const lineHeight = 12
  const maxLen = Math.max(...textLines.map((t) => t.length))
  const boxW = Math.min(220, Math.max(88, maxLen * 6.2 + padX * 2))
  const boxH = textLines.length * lineHeight + padY * 2
  const left = x - boxW / 2
  const top = y - boxH - 14

  return (
    <g transform={`translate(${left} ${top})`} role="presentation">
      <title>{title}</title>
      <rect
        width={boxW}
        height={boxH}
        rx={6}
        fill="rgba(15, 23, 42, 0.88)"
        stroke={color}
        strokeWidth={1.25}
        opacity={0.96}
      />
      {textLines.map((text, index) => (
        <text
          key={text}
          x={boxW / 2}
          y={padY + lineHeight * index + lineHeight * 0.78}
          textAnchor="middle"
          fill="rgba(248, 250, 252, 0.95)"
          fontSize={index === 0 && line2 ? 10 : 9}
          fontWeight={index === 0 && line2 ? 700 : 600}
        >
          {text}
        </text>
      ))}
    </g>
  )
}

function RoutePathLayer({
  layerKey,
  stations,
  pathPx,
  pathLegs,
  brokenLegs,
  color,
  emphasized = false,
  routeName,
  avgTravelTimeSeconds,
  minTravelTimeSeconds,
}: {
  layerKey: string
  stations: RouteStationPoint[]
  pathPx: Array<{ x: number; y: number }>
  pathLegs?: Array<Array<{ x: number; y: number }>>
  brokenLegs: Array<Array<{ x: number; y: number }>>
  color: string
  emphasized?: boolean
  routeName?: string
  avgTravelTimeSeconds?: number | null
  minTravelTimeSeconds?: number | null
}) {
  const markerId = `${layerKey}-arrow-end`
  const legs =
    pathLegs && pathLegs.length > 0
      ? pathLegs.filter((leg) => leg.length >= 2)
      : pathPx.length >= 2
        ? [pathPx]
        : []
  const badgeR = emphasized ? 12 : 10
  const arrows = useMemo(
    () => samplePathDirectionArrows(pathPx, emphasized ? 28 : 38),
    [pathPx, emphasized],
  )
  const timeSummary = formatRouteTravelTimeSummary(avgTravelTimeSeconds, minTravelTimeSeconds)
  const timeLabelPos = useMemo(
    () => resolveRoutePathMidpointPx(pathPx),
    [pathPx],
  )

  if (stations.length === 0 && legs.length === 0) return null

  return (
    <g>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path
            d="M 0 1 L 8 5 L 0 9"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={emphasized ? 0.9 : 0.55}
          />
        </marker>
      </defs>

      {legs.map((leg, legIndex) => (
        <polyline
          key={`${layerKey}-leg-${legIndex}`}
          fill="none"
          stroke={color}
          strokeWidth={emphasized ? 3.5 : 2}
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeMiterlimit={2}
          strokeDasharray={emphasized ? undefined : '8 6'}
          opacity={emphasized ? 0.85 : 0.4}
          markerEnd={
            legIndex === legs.length - 1 ? `url(#${markerId})` : undefined
          }
          points={leg.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      ))}

      {brokenLegs.map((leg, i) =>
        leg.length >= 2 ? (
          <polyline
            key={`${layerKey}-broken-${i}`}
            fill="none"
            stroke="rgba(248, 113, 113, 0.95)"
            strokeWidth={emphasized ? 3 : 2}
            strokeLinecap="round"
            strokeDasharray="6 5"
            opacity={emphasized ? 0.95 : 0.7}
            points={leg.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        ) : null,
      )}

      {arrows.map((arrow, i) => (
        <DirectionChevron
          key={`${layerKey}-dir-${i}`}
          x={arrow.x}
          y={arrow.y}
          angleDeg={arrow.angleDeg}
          color={color}
          size={emphasized ? 1.1 : 0.95}
        />
      ))}

      {stations.map((p, i) =>
        Number.isFinite(p.x) && Number.isFinite(p.y) ? (
        <g key={`${p.stationId}-${i}`}>
          <circle
            cx={p.x}
            cy={p.y}
            r={badgeR + 1}
            fill="rgba(15, 23, 42, 0.55)"
          />
          <circle
            cx={p.x}
            cy={p.y}
            r={badgeR}
            fill={color}
            stroke="rgba(255,255,255,0.92)"
            strokeWidth={emphasized ? 2 : 1.5}
          />
          <text
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(15, 23, 42, 0.95)"
            fontSize={emphasized ? 11 : 9}
            fontWeight={800}
          >
            {i + 1}
          </text>
        </g>
        ) : null,
      )}

      {emphasized && timeSummary && timeLabelPos ? (
        <RouteTravelTimeLabel
          x={timeLabelPos.x}
          y={timeLabelPos.y}
          label={timeSummary}
          routeName={routeName}
          color={color}
        />
      ) : null}
    </g>
  )
}

export const RoutePlanningOverlay = memo(function RoutePlanningOverlay({
  areas,
  pointTopology = null,
  activePreview,
  savedRoutes = [],
}: RoutePlanningOverlayProps) {
  const uid = useId().replace(/:/g, '')

  const activeGeometry = useMemo(
    () =>
      activePreview
        ? resolveRoutePreviewGeometry(
            areas,
            activePreview.stationIds,
            pointTopology,
          )
        : null,
    [areas, pointTopology, activePreview],
  )

  const savedLayers = useMemo(
    () =>
      savedRoutes.map(({ route, color, emphasized }) => ({
        route,
        color,
        emphasized,
        geometry:
          geometryFromPathWaypoints(areas, route, pointTopology) ??
          resolveRoutePreviewGeometry(
            areas,
            route.stationIds,
            pointTopology,
          ),
      })),
    [areas, pointTopology, savedRoutes],
  )

  const hasContent =
    (activeGeometry &&
      (activeGeometry.stations.length > 0 || activeGeometry.pathPx.length >= 2)) ||
    savedLayers.some(
      (l) =>
        l.geometry.stations.length > 0 || l.geometry.pathPx.length >= 2,
    )
  if (!hasContent) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[9000]"
      aria-hidden
    >
      <svg className="absolute left-0 top-0 overflow-visible" width="100%" height="100%">
        {savedLayers.map(({ route, color, geometry, emphasized }) =>
          geometry.stations.length > 0 || geometry.pathPx.length >= 2 ? (
            <RoutePathLayer
              key={route.routeId}
              layerKey={`${uid}-saved-${route.routeId}`}
              stations={geometry.stations}
              pathPx={geometry.pathPx}
              pathLegs={geometry.pathLegs}
              brokenLegs={geometry.brokenLegs}
              color={color}
              emphasized={emphasized ?? true}
              routeName={route.displayName}
              avgTravelTimeSeconds={route.avgTravelTimeSeconds}
              minTravelTimeSeconds={route.minTravelTimeSeconds}
            />
          ) : null,
        )}
        {activePreview && activeGeometry && activeGeometry.stations.length > 0 ? (
          <RoutePathLayer
            layerKey={`${uid}-active`}
            stations={activeGeometry.stations}
            pathPx={activeGeometry.pathPx}
            pathLegs={activeGeometry.pathLegs}
            brokenLegs={activeGeometry.brokenLegs}
            color={activePreview.color}
            emphasized={activePreview.emphasized ?? true}
            routeName={activePreview.label}
            avgTravelTimeSeconds={activePreview.avgTravelTimeSeconds}
            minTravelTimeSeconds={activePreview.minTravelTimeSeconds}
          />
        ) : null}
      </svg>
    </div>
  )
})
