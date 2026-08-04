import type { CrossoverSnapUi } from '../utils/crossoverSnapUi'

type HookCss = {
  x: number
  y: number
  fromX: number
  fromY: number
  horizontal: boolean
  openNx: number
  openNy: number
  engaged: boolean
  trackId: string
}

type Props = {
  width: number
  height: number
  /** 鄰近軌道中心線（Area CSS） */
  trackGlows: Array<{
    trackId: string
    x1: number
    y1: number
    x2: number
    y2: number
    primary: boolean
  }>
  hooks: HookCss[]
}

function TrackSnapHookMark({
  x,
  y,
  horizontal,
  openNx,
  openNy,
  engaged,
}: {
  x: number
  y: number
  horizontal: boolean
  openNx: number
  openNy: number
  engaged: boolean
}) {
  const alongX = horizontal ? 1 : 0
  const alongY = horizontal ? 0 : 1
  const arm = engaged ? 10 : 16
  const jaw = engaged ? 8 : 14
  const tip = engaged ? 5 : 8
  const baseL = { x: x - alongX * arm, y: y - alongY * arm }
  const baseR = { x: x + alongX * arm, y: y + alongY * arm }
  const midBack = {
    x: x - openNx * (engaged ? 2 : 4),
    y: y - openNy * (engaged ? 2 : 4),
  }
  const jawL = { x: baseL.x + openNx * jaw, y: baseL.y + openNy * jaw }
  const jawR = { x: baseR.x + openNx * jaw, y: baseR.y + openNy * jaw }
  const tipL = {
    x: jawL.x + alongX * tip * 0.35 + openNx * (engaged ? 1.5 : 3),
    y: jawL.y + alongY * tip * 0.35 + openNy * (engaged ? 1.5 : 3),
  }
  const tipR = {
    x: jawR.x - alongX * tip * 0.35 + openNx * (engaged ? 1.5 : 3),
    y: jawR.y - alongY * tip * 0.35 + openNy * (engaged ? 1.5 : 3),
  }
  const d = [
    `M ${tipL.x} ${tipL.y}`,
    `L ${jawL.x} ${jawL.y}`,
    `L ${baseL.x} ${baseL.y}`,
    `L ${midBack.x} ${midBack.y}`,
    `L ${baseR.x} ${baseR.y}`,
    `L ${jawR.x} ${jawR.y}`,
    `L ${tipR.x} ${tipR.y}`,
  ].join(' ')

  return (
    <g className="pointer-events-none">
      <circle
        cx={x}
        cy={y}
        r={engaged ? 22 : 28}
        fill={engaged ? 'rgba(56,189,248,0.18)' : 'rgba(250,204,21,0.14)'}
        stroke={engaged ? '#38bdf8' : '#facc15'}
        strokeWidth={2}
        strokeDasharray={engaged ? undefined : '5 4'}
      />
      <path
        d={d}
        fill={engaged ? 'rgba(56,189,248,0.45)' : 'rgba(250,204,21,0.28)'}
        stroke={engaged ? '#7dd3fc' : '#fde047'}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={x}
        cy={y}
        r={4}
        fill={engaged ? '#38bdf8' : '#facc15'}
        stroke="#0f172a"
        strokeWidth={1.25}
      />
      <text
        x={x}
        y={y - (engaged ? 30 : 36)}
        textAnchor="middle"
        className="fill-amber-100 text-[11px] font-semibold"
        style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,0.85)', strokeWidth: 3 }}
      >
        {engaged ? '已接合' : '靠近以勾住'}
      </text>
    </g>
  )
}

/**
 * 虛擬渡線拖曳時的 Area 頂層疊加：先標示鄰近軌道，再顯示勾子。
 */
export function CrossoverSnapOverlay({ width, height, trackGlows, hooks }: Props) {
  if (trackGlows.length === 0 && hooks.length === 0) return null

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ zIndex: 9600 }}
      aria-hidden
    >
      {trackGlows.map((g) => (
        <g key={g.trackId}>
          <line
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            stroke={g.primary ? '#facc15' : '#38bdf8'}
            strokeWidth={g.primary ? 14 : 10}
            strokeLinecap="round"
            opacity={g.primary ? 0.45 : 0.28}
          />
          <line
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            stroke={g.primary ? '#fde047' : '#7dd3fc'}
            strokeWidth={g.primary ? 4 : 3}
            strokeLinecap="round"
            opacity={0.95}
          />
        </g>
      ))}
      {hooks.map((h) => (
        <g key={`${h.trackId}-${h.fromX}-${h.fromY}`}>
          <line
            x1={h.fromX}
            y1={h.fromY}
            x2={h.x}
            y2={h.y}
            stroke={h.engaged ? '#38bdf8' : '#facc15'}
            strokeWidth={h.engaged ? 2.5 : 2}
            strokeDasharray={h.engaged ? undefined : '6 4'}
            opacity={0.9}
          />
          <TrackSnapHookMark
            x={h.x}
            y={h.y}
            horizontal={h.horizontal}
            openNx={h.openNx}
            openNy={h.openNy}
            engaged={h.engaged}
          />
        </g>
      ))}
    </svg>
  )
}

export type { CrossoverSnapUi }
