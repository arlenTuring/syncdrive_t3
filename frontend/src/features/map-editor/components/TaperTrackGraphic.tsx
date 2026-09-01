import type { CrossoverPortalKey } from '../utils/trackCrossoverFacility'

/**
 * 斜接軌道的外觀。
 *
 * 兩端各自以自己的寬度往垂直於連線方向張開，所以兩端寬度不同時就是一個梯形。
 * 那是<strong>刻意</strong>的：接合的目的就是與對手齊寬，而兩端的對手本來就可能不一樣寬；
 * 強制等寬反而會在接縫處留下段差。
 *
 * 端點的拖曳與吸附沿用虛擬渡線那一套（見 trackCrossoverFacility），這裡只負責畫。
 */

type PortalPoint = {
  key: CrossoverPortalKey
  x: number
  y: number
}

type Props = {
  width: number
  height: number
  /** 端點在區域 CSS 座標（px） */
  portalsLocal: PortalPoint[]
  /** 兩端寬度（px），順序與 portalsLocal 相同 */
  endWidthsPx: number[]
  /** 已接合的端點會標成實心，未接合是空心 */
  attached: boolean[]
  fill: string
  fillOpacity: number
  stroke: string
  emphasized: boolean
  readOnly: boolean
  onPortalPointerDown?: (key: CrossoverPortalKey, e: React.PointerEvent) => void
  onPortalPointerMove?: (e: React.PointerEvent) => void
  onPortalPointerUp?: (e: React.PointerEvent) => void
}

export function TaperTrackGraphic({
  width,
  height,
  portalsLocal,
  endWidthsPx,
  attached,
  fill,
  fillOpacity,
  stroke,
  emphasized,
  readOnly,
  onPortalPointerDown,
  onPortalPointerMove,
  onPortalPointerUp,
}: Props) {
  if (portalsLocal.length < 2) return null
  const [a, b] = portalsLocal as [PortalPoint, PortalPoint]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const ha = Math.max(1, endWidthsPx[0] ?? 8) / 2
  const hb = Math.max(1, endWidthsPx[1] ?? 8) / 2

  const quad = [
    [a.x + nx * ha, a.y + ny * ha],
    [b.x + nx * hb, b.y + ny * hb],
    [b.x - nx * hb, b.y - ny * hb],
    [a.x - nx * ha, a.y - ny * ha],
  ]
    .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
    >
      <polygon
        points={quad}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={emphasized ? 2 : 1}
        strokeLinejoin="round"
      />
      {!readOnly
        ? portalsLocal.map((p, i) => (
            <circle
              key={p.key}
              cx={p.x}
              cy={p.y}
              r={6}
              className="pointer-events-auto cursor-grab active:cursor-grabbing"
              fill={attached[i] ? '#22d3ee' : '#0f172a'}
              stroke="#22d3ee"
              strokeWidth={2}
              onPointerDown={(e) => onPortalPointerDown?.(p.key, e)}
              onPointerMove={onPortalPointerMove}
              onPointerUp={onPortalPointerUp}
              onPointerCancel={onPortalPointerUp}
            >
              <title>
                {attached[i]
                  ? '已接合；拖曳可改接其他軌道'
                  : '拖曳到軌道邊緣即可接合，接合後此端寬度會與對方齊平'}
              </title>
            </circle>
          ))
        : null}
    </svg>
  )
}
