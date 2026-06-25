/** 將角度正規化到 [0, 360) */
export function normalizeDegrees(deg: number): number {
  if (Number.isNaN(deg)) return 0
  return ((deg % 360) + 360) % 360
}

/** 矩形繞中心旋轉後的軸對齊包絡（AABB） */
export type RotatedRectAabb = {
  w: number
  h: number
  /** 自未旋轉 CSS 左上角至 AABB 左上角的偏移 */
  offsetLeft: number
  offsetTop: number
}

export function resolveRotatedRectAabb(
  w: number,
  h: number,
  rotationDeg: number,
): RotatedRectAabb {
  const deg = normalizeDegrees(rotationDeg)
  if (deg === 0) {
    return { w, h, offsetLeft: 0, offsetTop: 0 }
  }
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = w / 2
  const hh = h / 2
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of corners) {
    const x = c.x * cos - c.y * sin
    const y = c.x * sin + c.y * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return {
    w: maxX - minX,
    h: maxY - minY,
    offsetLeft: hw + minX,
    offsetTop: hh + minY,
  }
}

/** 螢幕視覺上的寬高（90°／270° 時交換本地 w/h） */
export function resolveVisualAxisSizePx(
  w: number,
  h: number,
  rotationDeg: number,
): { w: number; h: number } {
  const deg = normalizeDegrees(rotationDeg)
  if (deg === 90 || deg === 270) return { w: h, h: w }
  return { w, h }
}
