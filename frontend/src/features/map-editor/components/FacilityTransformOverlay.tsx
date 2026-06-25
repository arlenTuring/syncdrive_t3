/** 元件下方尺寸提示（維持水平可讀，不隨元件旋轉） */
export function FacilityTransformOverlay({
  widthM,
  heightM,
  widthPx,
  heightPx,
  anchorLeft,
  anchorTop,
  showSize = true,
  usePx = false,
}: {
  widthM: number
  heightM: number
  widthPx?: number
  heightPx?: number
  /** 錨點：視覺包絡下緣中心（FacilityNode 根層座標） */
  anchorLeft: number
  anchorTop: number
  showSize?: boolean
  /** 道路線等以 px 顯示本地寬高 */
  usePx?: boolean
}) {
  if (!showSize) return null
  const label = usePx
    ? `W: ${Math.round(widthPx ?? 0)} px · H: ${Math.round(heightPx ?? 0)} px`
    : `W: ${widthM.toFixed(1)} m · H: ${heightM.toFixed(1)} m`
  return (
    <div
      className="pointer-events-none absolute z-[5020] whitespace-nowrap rounded bg-cyan-500 px-3 py-0.5 font-mono text-xs font-bold text-white shadow-lg"
      style={{
        left: anchorLeft,
        top: anchorTop,
        transform: 'translateX(-50%)',
      }}
      aria-hidden
    >
      {label}
    </div>
  )
}
