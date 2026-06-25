/**
 * 將螢幕座標轉成畫布世界座標。
 * world 以 transform: scale(scaleX, scaleY)、transformOrigin 0 0 置於可捲動 viewport 內。
 */
export function clientToWorldCoords(
  clientX: number,
  clientY: number,
  world: HTMLDivElement,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } {
  const sx = scaleX > 0 ? scaleX : 1
  const sy = scaleY > 0 ? scaleY : 1
  const wr = world.getBoundingClientRect()
  const x = (clientX - wr.left) / sx
  const y = (clientY - wr.top) / sy
  return { x, y }
}
