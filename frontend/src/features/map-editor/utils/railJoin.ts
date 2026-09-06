import type { EndSegment } from './taperJoin'

/**
 * 由「要接上的那條邊」與「對面那一面」反推一般軌道的外框與旋轉角。
 *
 * <h3>一般軌道能吃下什麼</h3>
 * 它就是一個矩形：四個邊都能接，但兩個端面一定<strong>垂直於長邊</strong>、而且一樣寬。
 * 所以接上去的結果是——
 *
 * <ul>
 *   <li>被拖的那一面<strong>完全落在目標邊上</strong>，連寬度一起吃過來；</li>
 *   <li>整條沿著目標邊的法線伸出去，長度維持原本那一面到對面那一面的距離；</li>
 *   <li>伸的方向朝著<strong>自己原本在的那一側</strong>，不會突然翻到對手的另一邊。</li>
 * </ul>
 *
 * <h3>為什麼不要求兩端平行</h3>
 * 先前要求目標邊必須垂直於「對面中點 → 目標中點」那條軸，否則拒絕。兩塊軌道只要稍微
 * 錯開一點，那條軸就是斜的，於是幾乎永遠接不成——實測兩條相隔一段距離、又不同高的
 * 軌道，四個面對四個面十六種組合全部被拒。
 *
 * 矩形本來就做不到「兩端各自朝不同方向」，硬要兩端都不動是無解的。改成<strong>以目標邊
 * 為準</strong>：那一面貼上去，另一端跟著轉正。使用者拖的是哪一面，哪一面就說了算。
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
