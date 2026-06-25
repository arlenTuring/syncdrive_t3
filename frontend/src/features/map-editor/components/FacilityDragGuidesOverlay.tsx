import type { AlignGuideLine } from '../utils/facilityDragAlign'

type Props = {
  guides: AlignGuideLine[]
  activeRect?: { left: number; top: number; width: number; height: number } | null
  bounds?: { left: number; top: number; width: number; height: number } | null
}

const GUIDE_LINE_PX = 0.5

/** 拖曳設施時的對齊輔助線（Figma / 儀表板畫布同款青色線） */
export function FacilityDragGuidesOverlay({
  guides,
  activeRect = null,
  bounds = null,
}: Props) {
  const hasGuides = guides.length > 0
  const showCrosshair = !!activeRect && !!bounds
  if (!hasGuides && !showCrosshair) return null

  const cx = activeRect ? activeRect.left + activeRect.width / 2 : 0
  const cy = activeRect ? activeRect.top + activeRect.height / 2 : 0
  const bLeft = bounds?.left ?? 0
  const bTop = bounds?.top ?? 0
  const bRight = bounds ? bounds.left + bounds.width : 0
  const bBottom = bounds ? bounds.top + bounds.height : 0
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1500] overflow-visible"
      aria-hidden
    >
      {showCrosshair && (
        <>
          {/* 中心十字線（全域延伸） */}
          <div
            className="absolute bg-cyan-300/70"
            style={{
              left: cx,
              top: bTop,
              width: GUIDE_LINE_PX,
              height: Math.max(GUIDE_LINE_PX, bBottom - bTop),
            }}
          />
          <div
            className="absolute bg-cyan-300/70"
            style={{
              left: bLeft,
              top: cy,
              width: Math.max(GUIDE_LINE_PX, bRight - bLeft),
              height: GUIDE_LINE_PX,
            }}
          />

          {/* 元件四邊延伸輔助線（虛線） */}
          <div
            className="absolute border-l border-dashed border-cyan-400/40"
            style={{
              left: activeRect!.left,
              top: bTop,
              height: Math.max(GUIDE_LINE_PX, bBottom - bTop),
            }}
          />
          <div
            className="absolute border-l border-dashed border-cyan-400/40"
            style={{
              left: activeRect!.left + activeRect!.width,
              top: bTop,
              height: Math.max(GUIDE_LINE_PX, bBottom - bTop),
            }}
          />
          <div
            className="absolute border-t border-dashed border-cyan-400/40"
            style={{
              left: bLeft,
              top: activeRect!.top,
              width: Math.max(GUIDE_LINE_PX, bRight - bLeft),
            }}
          />
          <div
            className="absolute border-t border-dashed border-cyan-400/40"
            style={{
              left: bLeft,
              top: activeRect!.top + activeRect!.height,
              width: Math.max(GUIDE_LINE_PX, bRight - bLeft),
            }}
          />
        </>
      )}

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <div
            key={`v-${i}`}
            className="absolute bg-cyan-400/80"
            style={{
              left: g.at,
              top: g.from,
              width: GUIDE_LINE_PX,
              height: Math.max(GUIDE_LINE_PX, g.to - g.from),
            }}
          />
        ) : (
          <div
            key={`h-${i}`}
            className="absolute bg-cyan-400/80"
            style={{
              left: g.from,
              top: g.at,
              width: Math.max(GUIDE_LINE_PX, g.to - g.from),
              height: GUIDE_LINE_PX,
            }}
          />
        ),
      )}
    </div>
  )
}
