import type { CSSProperties } from 'react'

const DOOR_NORMAL = '#38bdf8'
const DOOR_ALARM = '#ef4444'
const TRACK_BG = 'rgba(74, 85, 101, 0.35)'
const END_CAP_BG = 'rgba(100, 116, 139, 0.55)'

type PlatformDoorGraphicProps = {
  /** 像素寬（元件內可用寬度） */
  widthPx: number
  /** 像素高 */
  heightPx: number
  /** 0 = 全關（兩片於中央接合），100 = 全開（兩片縮至兩端） */
  openPercent: number
  alarm?: boolean
  /** 動畫過渡（MQTT 更新時） */
  animate?: boolean
}

/**
 * 月台門：左右固定橫桿（不填色）＋中間軌道；門片自兩側往中央閉合／自中央往兩側開啟。
 * 始終以左右兩片渲染，避免 0% 時切換成單一元素造成由左填滿的錯覺動畫。
 */
export function PlatformDoorGraphic({
  widthPx,
  heightPx,
  openPercent,
  alarm = false,
  animate = true,
}: PlatformDoorGraphicProps) {
  const w = Math.max(24, widthPx)
  const h = Math.max(8, heightPx)
  const ratio = Math.min(1, Math.max(0, openPercent / 100))
  const doorColor = alarm ? DOOR_ALARM : DOOR_NORMAL

  const barH = Math.max(4, Math.min(h * 0.5, h - 2))
  const barTop = (h - barH) / 2
  const radius = barH / 2

  /** 兩端固定突出橫桿寬度 */
  const endCapW = Math.max(radius * 1.15, w * 0.1, 6)
  const doorZoneLeft = endCapW
  const doorZoneW = Math.max(8, w - 2 * endCapW)
  const half = doorZoneW / 2
  const minLeafW = Math.max(radius * 1.05, barH * 0.88)
  const leafW = Math.max(minLeafW, half * (1 - ratio))

  const leftLeafLeft = doorZoneLeft
  const rightLeafLeft = doorZoneLeft + doorZoneW - leafW

  const transition = animate
    ? 'width 0.45s cubic-bezier(0.4, 0, 0.2, 1), left 0.45s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease'
    : undefined

  const glow = alarm
    ? `0 0 10px ${DOOR_ALARM}99`
    : `0 0 8px ${DOOR_NORMAL}66`

  const leafStyle = (side: 'left' | 'right'): CSSProperties => ({
    top: barTop,
    width: leafW,
    height: barH,
    backgroundColor: doorColor,
    boxShadow: glow,
    transition,
    borderRadius:
      side === 'left'
        ? `${radius}px 2px 2px ${radius}px`
        : `2px ${radius}px ${radius}px 2px`,
  })

  return (
    <div
      className="relative shrink-0"
      style={{ width: w, height: h }}
      aria-hidden
    >
      {/* 中間軌道（淡色底，非門片） */}
      <div
        className="absolute"
        style={{
          left: doorZoneLeft,
          top: barTop,
          width: doorZoneW,
          height: barH,
          borderRadius: 2,
          backgroundColor: TRACK_BG,
        }}
      />

      {/* 左端固定橫桿（不隨開度填色） */}
      <div
        className="absolute"
        style={{
          left: 0,
          top: barTop,
          width: endCapW,
          height: barH,
          borderRadius: `${radius}px 2px 2px ${radius}px`,
          backgroundColor: END_CAP_BG,
        }}
      />

      {/* 右端固定橫桿 */}
      <div
        className="absolute"
        style={{
          left: w - endCapW,
          top: barTop,
          width: endCapW,
          height: barH,
          borderRadius: `2px ${radius}px ${radius}px 2px`,
          backgroundColor: END_CAP_BG,
        }}
      />

      {/* 左門片：自左側往中央 */}
      <div
        className="absolute"
        style={{ left: leftLeafLeft, ...leafStyle('left') }}
      />

      {/* 右門片：自右側往中央 */}
      <div
        className="absolute"
        style={{ left: rightLeafLeft, ...leafStyle('right') }}
      />

      {alarm && (
        <div
          className="pointer-events-none absolute animate-pulse"
          style={{
            left: doorZoneLeft,
            top: barTop,
            width: doorZoneW,
            height: barH,
            borderRadius: 2,
            boxShadow: `inset 0 0 0 1px ${DOOR_ALARM}88`,
          }}
        />
      )}
    </div>
  )
}
