import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type MapFloatingAnchorPortalProps = {
  open: boolean
  /** 地圖內錨點（可為 size-0）；以其 getBoundingClientRect 對齊螢幕 */
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** 相對錨點頂邊的額外偏移（px，螢幕座標） */
  offsetY?: number
  /**
   * 水平對齊錨點：
   * - center：錨點中心（預設，設施圓形工具列）
   * - end：錨點右緣（圍籬右上角工具列）
   */
  alignX?: 'center' | 'end'
  /** 傳給 portal 根節點，供 closest / 命中測試 */
  dataAttr?: string
}

/**
 * 將 UI 以 fixed 掛到 document.body，跟隨地圖內錨點。
 * 避開 Area／圖台 overflow:hidden，邊緣選取時工具列仍可完整顯示。
 */
export function MapFloatingAnchorPortal({
  open,
  anchorRef,
  children,
  className,
  style,
  offsetY = 0,
  alignX = 'center',
  dataAttr,
}: MapFloatingAnchorPortalProps) {
  const [screen, setScreen] = useState<{ x: number; y: number } | null>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) {
      setScreen(null)
      return
    }

    let raf = 0
    const tick = () => {
      const anchor = anchorRef.current
      if (anchor) {
        const r = anchor.getBoundingClientRect()
        const x = alignX === 'end' ? r.right : r.left + r.width / 2
        const y = r.top + offsetY
        setScreen((prev) => {
          if (prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5) {
            return prev
          }
          return { x, y }
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, anchorRef, offsetY, alignX])

  if (!open || !screen || typeof document === 'undefined') return null

  const transform =
    alignX === 'end' ? 'translateX(-100%)' : 'translateX(-50%)'

  return createPortal(
    <div
      ref={portalRef}
      className={className}
      {...(dataAttr ? { [dataAttr]: '' } : {})}
      style={{
        position: 'fixed',
        left: screen.x,
        top: screen.y,
        transform,
        zIndex: 9200,
        ...style,
      }}
      onPointerDown={(e) => {
        // Portal 在 DOM 上掛 body，但 React 仍會冒泡回 FacilityNode；必須擋下避免當成拖曳／點空白
        e.stopPropagation()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
