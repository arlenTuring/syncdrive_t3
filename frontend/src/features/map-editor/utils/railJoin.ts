import type { EndSegment } from './taperJoin'

/**
 * 由兩條端面線段反推一般軌道的外框與旋轉角。
 *
 * <h3>一般軌道能吃下什麼</h3>
 * 它就是一個矩形，兩端一樣寬。所以把一端拖到別條軌道的邊上時，<strong>整條的寬度</strong>
 * 跟著變成那條邊的長度——兩端不同寬的情形要用斜接軌道，那是另一個元件。
 *
 * 另一端的中點留在原地，長度與方向由兩個中點決定；矩形因此可以轉到任意角度去接。
 * 第一個參數是<strong>正在拖的那一面</strong>，寬度由它決定。
 *
 * <h3>角度有兩種表示法</h3>
 * 回傳的是「另一端 → 目標」這個方向的角度。矩形轉 180 度長得一模一樣，所以呼叫端要自己
 * 挑與原角度較接近的那一個，不然接左邊那一面時會算出 180 度，形狀沒變、文字卻整個顛倒。
 *
 * <h3>限制</h3>
 * 目標邊必須與接出來的<strong>行進方向垂直</strong>——矩形的端面本來就垂直於長邊。
 * 斜的邊接不出矩形，回傳 null，呼叫端維持原狀。
 */

/** 端面與行進方向的夾角容許誤差（度） */
const PERP_TOL_DEG = 3

type Built = {
  box: { x: number; y: number; w: number; h: number }
  rotationDeg: number
}

export function buildRectFromEndSegments(a: EndSegment, b: EndSegment): Built | null {
  const mid = (s: EndSegment) => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 })
  const len = (s: EndSegment) => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y)

  const ma = mid(a)
  const mb = mid(b)
  const ax = ma.x - mb.x
  const ay = ma.y - mb.y
  const length = Math.hypot(ax, ay)
  if (length < 1) return null

  /*
   * 寬度取<strong>第一個參數</strong>那一面的長度——呼叫端傳的是使用者正在拖的那一面，
   * 也就是對手軌道的邊。矩形兩端一樣寬，所以整條跟著變成那個寬度；另一端只留中點，
   * 它的方向會跟著新的行進方向轉過去。
   */
  const width = len(a)
  if (width < 1) return null

  // 目標那一面要垂直於行進方向，不然矩形的端面落不到那條邊上
  const ux = ax / length
  const uy = ay / length
  const al = len(a)
  const dot = Math.abs(((a[1].x - a[0].x) / al) * ux + ((a[1].y - a[0].y) / al) * uy)
  if (dot > Math.sin((PERP_TOL_DEG * Math.PI) / 180)) return null

  const centre = { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 }
  const rotationDeg = (Math.atan2(uy, ux) * 180) / Math.PI
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
