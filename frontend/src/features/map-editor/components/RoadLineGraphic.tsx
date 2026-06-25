import type { ReactNode } from 'react'
import type { RoadLineStyle } from '../utils/roadLineFacility'

type Props = {
  width: number
  height: number
  style: RoadLineStyle
  strokeWidthPx: number
  color: string
}

function ArrowHead({
  x,
  y,
  size,
  color,
  direction = 1,
}: {
  x: number
  y: number
  size: number
  color: string
  direction?: 1 | -1
}) {
  const half = size * 0.42
  const tipX = x + size * 0.55 * direction
  return (
    <polygon
      points={`${x},${y - half} ${tipX},${y} ${x},${y + half}`}
      fill={color}
    />
  )
}

export function RoadLineGraphic({
  width,
  height,
  style,
  strokeWidthPx,
  color,
}: Props) {
  const sw = Math.max(1, strokeWidthPx)
  const cy = height / 2
  const pad = Math.min(sw, width * 0.02)
  const x1 = pad
  const x2 = Math.max(pad, width - pad)
  const svgProps = {
    width,
    height,
    className: 'pointer-events-none block',
    'aria-hidden': true as const,
    overflow: 'visible' as const,
  }

  const solidLine = (key: string, y: number, lineSw = sw) => (
    <line
      key={key}
      x1={x1}
      y1={y}
      x2={x2}
      y2={y}
      stroke={color}
      strokeWidth={lineSw}
      strokeLinecap="round"
    />
  )

  if (style === 'singleSolid') {
    return (
      <svg {...svgProps}>
        {solidLine('single', cy)}
      </svg>
    )
  }

  if (style === 'doubleSolid') {
    const gap = sw * 0.65
    const lineSw = Math.max(1, sw * 0.42)
    const yTop = cy - gap / 2
    const yBottom = cy + gap / 2
    return (
      <svg {...svgProps}>
        {solidLine('top', yTop, lineSw)}
        {solidLine('bottom', yBottom, lineSw)}
      </svg>
    )
  }

  if (style === 'dotted') {
    return (
      <svg {...svgProps}>
        <line
          x1={x1}
          y1={cy}
          x2={x2}
          y2={cy}
          stroke={color}
          strokeWidth={sw}
          strokeDasharray={`0 ${sw * 2.4}`}
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (style === 'dashed') {
    const dash = sw * 5
    const gap = sw * 3
    return (
      <svg {...svgProps}>
        <line
          x1={x1}
          y1={cy}
          x2={x2}
          y2={cy}
          stroke={color}
          strokeWidth={sw}
          strokeDasharray={`${dash} ${gap}`}
          strokeLinecap="butt"
        />
      </svg>
    )
  }

  if (style === 'dashedArrows') {
    const dashLen = sw * 6
    const gapLen = sw * 3.5
    const arrowSize = sw * 1.6
    const step = dashLen + gapLen
    const segments: ReactNode[] = []
    for (let x = x1 + dashLen; x <= x2 + dashLen * 0.25; x += step) {
      const segEnd = Math.min(x - arrowSize * 0.35, x2)
      const segStart = Math.max(x1, x - dashLen)
      if (segEnd <= segStart) continue
      segments.push(
        <line
          key={`d-${x}`}
          x1={segStart}
          y1={cy}
          x2={segEnd}
          y2={cy}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />,
      )
      if (segEnd < x2 - sw * 0.5) {
        segments.push(
          <ArrowHead
            key={`a-${x}`}
            x={segEnd}
            y={cy}
            size={arrowSize}
            color={color}
          />,
        )
      }
    }
    return (
      <svg {...svgProps}>
        {segments}
      </svg>
    )
  }

  const spacing = sw * 5.5
  const arrowSize = sw * 1.5
  const arrows: ReactNode[] = []
  for (let x = x1 + spacing * 0.5; x < x2; x += spacing) {
    arrows.push(
      <ArrowHead key={x} x={x} y={cy} size={arrowSize} color={color} />,
    )
  }
  return (
    <svg {...svgProps}>
      <line
        x1={x1}
        y1={cy}
        x2={x2}
        y2={cy}
        stroke={color}
        strokeWidth={Math.max(1, sw * 0.35)}
        strokeLinecap="round"
        opacity={0.85}
      />
      {arrows}
    </svg>
  )
}
