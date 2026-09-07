import type { EndSegment } from './taperJoin'

/**
 * 由「要接上的那條邊」與「對面那一面」反推一般軌道的外框與旋轉角。
 *
 * 寬度取被拖的那一面，長度沿那一面的法線量到對面。矩形 180 度對稱，所以旋轉角
 * 由呼叫端收進 ±90 度，避免元件無故翻面。
 */

type Built = {
  box: { x: number; y: number; w: number; h: number }
  rotationDeg: number
}

export function buildRectFromEndSegments(target: EndSegment, other: EndSegment): Built | null {
  const mid = (s: EndSegment) => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 })
  const len = (s: EndSegment) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)

  const width = len(target)
  if (width < 1) return null

  const tm = mid(target)
  const om = mid(other)

  // 目標邊的法線就是接上去之後的行進方向
  let nx = -(target[1].y - target[0].y) / width
  let ny = (target[1].x - target[0].x) / width
  // 朝自己原本在的那一側伸，不然整條會翻到對手的另一邊
  if ((om.x - tm.x) * nx + (om.y - tm.y) * ny < 0) {
    nx = -nx
    ny = -ny
  }

  /*
   * 長度取「對面那一面離目標邊多遠」——沿法線量。太短就退回一個帶寬，不然會縮成一條線，
   * 連把手都抓不到。
   */
  const length = Math.max(width, (om.x - tm.x) * nx + (om.y - tm.y) * ny)

  const centre = { x: tm.x + nx * (length / 2), y: tm.y + ny * (length / 2) }
  const rotationDeg = (Math.atan2(ny, nx) * 180) / Math.PI
  return {
    box: {
      x: centre.x - length / 2,
      y: centre.y - width / 2,
      w: length,
      h: width,
    },
    rotationDeg,
  }
}
