import type { PointerEvent as ReactPointerEvent } from 'react'
import type {
  CrossoverPortalKey,
  CrossoverPortals,
} from '../utils/trackCrossoverFacility'
import {
  CROSSOVER_PORTAL_KEYS,
  TRACK_CROSSOVER_EDGE_STROKE_PX,
} from '../utils/trackCrossoverFacility'

export type PortalLocalPoint = {
  key: CrossoverPortalKey
  x: number
  y: number
  attached: boolean
}

type Props = {
  width: number
  height: number
  portalsLocal: PortalLocalPoint[]
  color: string
  /** 邊緣線透明度 0–100 */
  colorOpacity?: number
  /** 線徑總寬（兩邊緣線中心距），不是邊緣線本身粗細 */
  strokeWidthPx: number
  /** 中間消失程度 0–100：從中心向兩端對稱張開 */
  centerGapPct?: number
  /** 走廊背景色；null／空＝不繪製 */
  bgColor?: string | null
  /** 背景透明度 0–100 */
  bgOpacity?: number
  emphasized?: boolean
  interactive?: boolean
  /** 選取時顯示線徑寬度把手 */
  showWidthHandles?: boolean
  onPortalPointerDown?: (
    key: CrossoverPortalKey,
    e: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onPortalPointerMove?: (e: ReactPointerEvent<SVGCircleElement>) => void
  onPortalPointerUp?: (e: ReactPointerEvent<SVGCircleElement>) => void
  onWidthPointerDown?: (e: ReactPointerEvent<SVGRectElement>) => void
  onWidthPointerMove?: (e: ReactPointerEvent<SVGRectElement>) => void
  onWidthPointerUp?: (e: ReactPointerEvent<SVGRectElement>) => void
}

function linePerpGeometry(pa: PortalLocalPoint, pb: PortalLocalPoint) {
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    ux,
    uy,
    /** 單位法線（垂直於線徑） */
    px: -uy,
    py: ux,
    len,
  }
}

function lerp2(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
}

/** B→A 方向箭頭：棒身 + 較大三角尖；回傳棒線端點與三角 polygon */
function directionArrowGeometry(
  tipX: number,
  tipY: number,
  ux: number,
  uy: number,
  {
    headLength = 8,
    halfWidth = 4.5,
    shaftLength = 9,
  }: { headLength?: number; halfWidth?: number; shaftLength?: number } = {},
): {
  shaft: { x1: number; y1: number; x2: number; y2: number }
  points: string
} {
  const headBaseX = tipX - ux * headLength
  const headBaseY = tipY - uy * headLength
  const shaftStartX = headBaseX - ux * shaftLength
  const shaftStartY = headBaseY - uy * shaftLength
  const px = -uy
  const py = ux
  const lX = headBaseX + px * halfWidth
  const lY = headBaseY + py * halfWidth
  const rX = headBaseX - px * halfWidth
  const rY = headBaseY - py * halfWidth
  return {
    shaft: {
      x1: shaftStartX,
      y1: shaftStartY,
      x2: headBaseX,
      y2: headBaseY,
    },
    points: `${tipX},${tipY} ${lX},${lY} ${rX},${rY}`,
  }
}

/**
 * 依中心間隙比例，把一條邊切成兩段實線（從中間向兩端對稱消失）。
 * gapPct=0 → 整段；gapPct=100 → 幾乎只留兩端點附近。
 */
function solidEdgeSegmentsWithCenterGap(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  gapPct: number,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const g = Math.min(0.95, Math.max(0, gapPct / 100))
  if (g <= 0.001) {
    return [{ x1, y1, x2, y2 }]
  }
  const tVisible = (1 - g) / 2
  if (tVisible <= 0.001) return []
  const pA = lerp2(x1, y1, x2, y2, tVisible)
  const pB = lerp2(x1, y1, x2, y2, 1 - tVisible)
  return [
    { x1, y1, x2: pA.x, y2: pA.y },
    { x1: pB.x, y1: pB.y, x2, y2 },
  ]
}

/**
 * 雙邊緣實線線徑：調寬拉開間距；中間可對稱消失。
 * 鄰近軌道標示／勾子由 Area 層 CrossoverSnapOverlay 處理。
 */
export function TrackCrossoverGraphic({
  width,
  height,
  portalsLocal,
  color,
  colorOpacity = 100,
  strokeWidthPx,
  centerGapPct = 0,
  bgColor = null,
  bgOpacity = 35,
  emphasized = false,
  interactive = false,
  showWidthHandles = false,
  onPortalPointerDown,
  onPortalPointerMove,
  onPortalPointerUp,
  onWidthPointerDown,
  onWidthPointerMove,
  onWidthPointerUp,
}: Props) {
  const byKey = new Map(portalsLocal.map((p) => [p.key, p]))
  const pa = byKey.get('a')
  const pb = byKey.get('b')
  const pathW = Math.max(6, strokeWidthPx)
  const half = pathW / 2
  const edgeSw = TRACK_CROSSOVER_EDGE_STROKE_PX
  /** 端點要夠大才拖得動；接合回饋在 Area 勾子疊層 */
  const portalR = emphasized || interactive ? 5.5 : 3.5
  const portalHitR = interactive ? 16 : portalR
  const lineOpacity = Math.min(
    1,
    Math.max(0.05, (colorOpacity / 100) * (emphasized ? 1 : 0.95)),
  )
  const fillOpacity = Math.min(1, Math.max(0, bgOpacity / 100))
  const accent = emphasized ? '#38bdf8' : color
  const hasBg =
    typeof bgColor === 'string' &&
    bgColor.trim() !== '' &&
    bgColor !== 'none' &&
    bgColor !== 'transparent' &&
    fillOpacity > 0.001
  const geom = pa && pb ? linePerpGeometry(pa, pb) : null
  const widthHandleOffset = Math.max(half + 8, 12)
  /** 兩邊邊緣各一組把手（近兩端），對稱拉開線徑寬度 */
  const widthHandles =
    geom && pa && pb && showWidthHandles && interactive
      ? ([0.22, 0.78] as const).flatMap((t) => {
          const along = lerp2(pa.x, pa.y, pb.x, pb.y, t)
          return ([1, -1] as const).map((sign) => ({
            key: `w-${t}-${sign}`,
            x: along.x + geom.px * widthHandleOffset * sign,
            y: along.y + geom.py * widthHandleOffset * sign,
          }))
        })
      : []

  const edgeFull =
    geom && pa && pb
      ? ([1, -1] as const).map((sign) => {
          const ox = geom.px * half * sign
          const oy = geom.py * half * sign
          return {
            x1: pa.x + ox,
            y1: pa.y + oy,
            x2: pb.x + ox,
            y2: pb.y + oy,
          }
        })
      : []
  const edgeSegments = edgeFull.flatMap((edge, edgeIdx) =>
    solidEdgeSegmentsWithCenterGap(
      edge.x1,
      edge.y1,
      edge.x2,
      edge.y2,
      centerGapPct,
    ).map((seg, segIdx) => ({ ...seg, key: `edge-${edgeIdx}-${segIdx}` })),
  )
  const bgSegments =
    hasBg && pa && pb
      ? solidEdgeSegmentsWithCenterGap(
          pa.x,
          pa.y,
          pb.x,
          pb.y,
          centerGapPct,
        ).map((seg, i) => ({ ...seg, key: `bg-${i}` }))
      : []

  return (
    <svg
      width={width}
      height={height}
      className="block overflow-visible pointer-events-none"
      aria-hidden={!interactive}
      style={{ overflow: 'visible' }}
    >
      {pa && pb ? (
        <>
          {/* 寬命中帶：拖線身＝整組平移 */}
          <line
            data-crossover-line-hit
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="transparent"
            strokeWidth={Math.max(18, pathW + 12)}
            strokeLinecap="round"
            className={interactive ? 'pointer-events-auto cursor-move' : undefined}
          />
          {/* 走廊背景（預設無）；與中間缺口同步 */}
          {bgSegments.map((seg) => (
            <line
              key={seg.key}
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={bgColor!}
              strokeWidth={pathW}
              strokeLinecap="butt"
              opacity={fillOpacity}
              className="pointer-events-none"
            />
          ))}
          {/* 兩條邊緣實線；中間可對稱消失 */}
          {edgeSegments.map((seg) => (
            <line
              key={seg.key}
              data-crossover-line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={accent}
              strokeWidth={edgeSw}
              strokeLinecap="round"
              opacity={lineOpacity}
              className="pointer-events-none"
            />
          ))}
          {/* 方向：永遠 B → A；B 端出發、A 端接入各一枚帶棒箭頭 */}
          {geom && pa && pb ? (
            <g className="pointer-events-none" opacity={lineOpacity} aria-hidden>
              {(() => {
                // 行進方向 B→A
                const ux = -geom.ux
                const uy = -geom.uy
                const outGap = portalR + 3
                const inGap = portalR + 2
                const outTip = {
                  x: pb.x + ux * (outGap + 17),
                  y: pb.y + uy * (outGap + 17),
                }
                const inTip = {
                  x: pa.x - ux * inGap,
                  y: pa.y - uy * inGap,
                }
                const outArrow = directionArrowGeometry(outTip.x, outTip.y, ux, uy)
                const inArrow = directionArrowGeometry(inTip.x, inTip.y, ux, uy)
                return (
                  <>
                    <line
                      x1={outArrow.shaft.x1}
                      y1={outArrow.shaft.y1}
                      x2={outArrow.shaft.x2}
                      y2={outArrow.shaft.y2}
                      stroke={accent}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                    />
                    <polygon points={outArrow.points} fill={accent} />
                    <line
                      x1={inArrow.shaft.x1}
                      y1={inArrow.shaft.y1}
                      x2={inArrow.shaft.x2}
                      y2={inArrow.shaft.y2}
                      stroke={accent}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                    />
                    <polygon points={inArrow.points} fill={accent} />
                  </>
                )
              })()}
            </g>
          ) : null}
        </>
      ) : null}

      {widthHandles.map((h) => (
        <rect
          key={h.key}
          data-crossover-width-handle
          x={h.x - 4}
          y={h.y - 4}
          width={8}
          height={8}
          rx={1.5}
          fill="#0f172a"
          stroke="#38bdf8"
          strokeWidth={1.25}
          className="pointer-events-auto cursor-ns-resize"
          onPointerDown={onWidthPointerDown}
          onPointerMove={onWidthPointerMove}
          onPointerUp={onWidthPointerUp}
          onPointerCancel={onWidthPointerUp}
        >
          <title>拖曳調整兩邊線徑寬度（兩邊緣線間距）</title>
        </rect>
      ))}

      {CROSSOVER_PORTAL_KEYS.map((key) => {
        const p = byKey.get(key)
        if (!p) return null
        const other = key === 'a' ? pb : pa
        // 選取時標籤往線徑外側偏移，避免壓在把手／線上
        let labelX = p.x
        let labelY = p.y - (portalR + 12)
        if (other) {
          const dx = p.x - other.x
          const dy = p.y - other.y
          const len = Math.hypot(dx, dy)
          if (len > 0.001) {
            const ox = dx / len
            const oy = dy / len
            labelX = p.x + ox * (portalR + 11)
            labelY = p.y + oy * (portalR + 11)
          }
        }
        return (
          <g key={key}>
            <circle
              data-crossover-portal-handle
              cx={p.x}
              cy={p.y}
              r={portalHitR}
              fill="transparent"
              className={
                interactive
                  ? 'cursor-crosshair pointer-events-auto'
                  : 'pointer-events-none'
              }
              onPointerDown={
                interactive && onPortalPointerDown
                  ? (ev) => onPortalPointerDown(key, ev)
                  : undefined
              }
              onPointerMove={interactive ? onPortalPointerMove : undefined}
              onPointerUp={interactive ? onPortalPointerUp : undefined}
              onPointerCancel={interactive ? onPortalPointerUp : undefined}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={portalR}
              fill={
                p.attached ? 'rgba(56, 189, 248, 0.55)' : 'rgba(15, 23, 42, 0.9)'
              }
              stroke={p.attached ? '#38bdf8' : accent}
              strokeWidth={emphasized ? 1.25 : 1}
              opacity={emphasized ? 1 : 0.88}
              className="pointer-events-none"
            />
            {emphasized ? (
              <g className="pointer-events-none" aria-hidden>
                <circle
                  cx={labelX}
                  cy={labelY}
                  r={7.5}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth={1.25}
                  opacity={0.95}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e0f2fe"
                  fontSize={10}
                  fontWeight={700}
                  style={{
                    fontFamily:
                      'ui-sans-serif, system-ui, -apple-system, sans-serif',
                  }}
                >
                  {key === 'a' ? 'A' : 'B'}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export function portalsToLocalPoints(
  portals: CrossoverPortals,
  aabb: { xMinM: number; yMinM: number; xMaxM: number; yMaxM: number },
  widthPx: number,
  heightPx: number,
): PortalLocalPoint[] {
  const spanX = Math.max(0.001, aabb.xMaxM - aabb.xMinM)
  const spanY = Math.max(0.001, aabb.yMaxM - aabb.yMinM)
  return CROSSOVER_PORTAL_KEYS.map((key) => {
    const p = portals[key]
    const x = ((p.xM - aabb.xMinM) / spanX) * widthPx
    const y = ((aabb.yMaxM - p.yM) / spanY) * heightPx
    return { key, x, y, attached: !!p.attachedTrackId }
  })
}

/** 場域公尺端點 → Area CSS 座標（左上原點），供整區疊層自由線使用 */
export function portalsToAreaCssPoints(
  portals: CrossoverPortals,
  layout: { wPx: number; hPx: number },
  meterToLocal: (xM: number, yM: number) => { x: number; y: number },
): PortalLocalPoint[] {
  return CROSSOVER_PORTAL_KEYS.map((key) => {
    const p = portals[key]
    const area = meterToLocal(p.xM, p.yM)
    return {
      key,
      x: area.x,
      y: layout.hPx - area.y,
      attached: !!p.attachedTrackId,
    }
  })
}

/** 由線中點到指標的法線距離推算線徑總寬（兩邊緣間距，px） */
export function strokePxFromWidthHandlePointer(
  portalsLocal: PortalLocalPoint[],
  pointerCss: { x: number; y: number },
): number | null {
  const pa = portalsLocal.find((p) => p.key === 'a')
  const pb = portalsLocal.find((p) => p.key === 'b')
  if (!pa || !pb) return null
  const geom = linePerpGeometry(pa, pb)
  const vx = pointerCss.x - geom.mid.x
  const vy = pointerCss.y - geom.mid.y
  const half = Math.abs(vx * geom.px + vy * geom.py)
  return half * 2
}
