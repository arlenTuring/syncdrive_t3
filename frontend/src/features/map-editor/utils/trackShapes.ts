/**
 * 圓角軌道與斜接軌道的幾何。
 *
 * <h3>為什麼要有這兩種元件</h3>
 * 一般軌道是矩形，兩塊相鄰就自然接得起來。但轉彎與變換股道這兩件事矩形做不到：
 * 用一條粗折線去畫，橫向偏移一改變就會在轉折處撕出裂縫與尖角——看起來破碎，
 * 而且那整條線是一個圖形，不是使用者能個別拉伸與設定的物件。
 *
 * 所以拆成三種可獨立操作的軌道：
 *
 *   一般軌道    矩形，既有的 Track
 *   圓角軌道    直腳 → 圓弧 → 直腳，等寬。兩端可拉長，圓弧半徑可調
 *   斜接軌道    四邊形，兩端各自有寬度。端點吸附到別的軌道後寬度跟著對方走
 *
 * 斜接軌道兩端寬度可以不同是<strong>刻意</strong>的：接合的目的就是與對手齊寬，
 * 而兩端的對手本來就可能不一樣寬。強制等寬反而會在接縫處留下段差。
 */

export type ShapePoint = { x: number; y: number }

/* ── 圓角軌道 ───────────────────────────────────────────────── */

export type CornerTrackGeometry = {
  /** 軌道寬（公尺） */
  widthM: number
  /** 中心線圓弧半徑（公尺） */
  radiusM: number
  /** 進入端直線段長度（公尺） */
  legInM: number
  /** 離開端直線段長度（公尺） */
  legOutM: number
  /** 轉角，正值左轉、負值右轉。目前只用 ±90 */
  turnDeg: number
}

export const DEFAULT_CORNER_TRACK: CornerTrackGeometry = {
  widthM: 3.5,
  radiusM: 12,
  legInM: 8,
  legOutM: 8,
  turnDeg: -90,
}

/** 圓角軌道的外接尺寸（公尺），用來決定設施的 areaSizePx */
export function cornerTrackSizeM(g: CornerTrackGeometry): { w: number; h: number } {
  const half = g.widthM / 2
  const outer = g.radiusM + half
  return {
    w: Math.max(0.5, g.legInM + outer),
    h: Math.max(0.5, g.legOutM + outer),
  }
}

/**
 * 圓角軌道的填色外框。
 *
 * 以左上角為原點的區域座標（y 向下）產生；進入端在左、離開端在下，
 * 其餘方向靠設施本身的 rotationDeg 轉。
 *
 * 外緣與內緣各自是「直線 → 圓弧 → 直線」，兩者半徑差一個軌道寬，
 * 所以整條路徑等寬、沒有接縫。
 */
export function cornerTrackPath(
  g: CornerTrackGeometry,
  pxPerMX: number,
  pxPerMY: number,
): string {
  const half = g.widthM / 2
  const rOuter = g.radiusM + half
  const rInner = Math.max(0, g.radiusM - half)
  const size = cornerTrackSizeM(g)

  /*
   * 圓心就在直腳結束的地方：水平進來走 legIn 之後開始轉彎，
   * 所以圓心 x 等於 legIn，y 等於「半寬 ＋ 半徑」也就是 rOuter。
   * 外緣是半徑 rOuter 的弧、內緣是 rInner，兩者同心，整段才會等寬。
   */
  const cx = g.legInM
  const cy = rOuter

  const X = (m: number) => (m * pxPerMX).toFixed(2)
  const Y = (m: number) => (m * pxPerMY).toFixed(2)

  // 外緣：從左端上緣出發，往右到弧起點，繞外弧到下方，再往下到離開端
  const outerStart = { x: 0, y: cy - rOuter }
  const outerArcEnd = { x: cx + rOuter, y: cy }
  // 內緣：回程
  const innerStart = { x: cx + rInner, y: cy }
  const innerArcEnd = { x: 0, y: cy - rInner }

  const rx = (rOuter * pxPerMX).toFixed(2)
  const ry = (rOuter * pxPerMY).toFixed(2)
  const irx = (rInner * pxPerMX).toFixed(2)
  const iry = (rInner * pxPerMY).toFixed(2)

  return [
    `M ${X(outerStart.x)} ${Y(outerStart.y)}`,
    `L ${X(cx)} ${Y(outerStart.y)}`,
    `A ${rx} ${ry} 0 0 0 ${X(outerArcEnd.x)} ${Y(outerArcEnd.y)}`,
    `L ${X(outerArcEnd.x)} ${Y(size.h)}`,
    `L ${X(innerStart.x)} ${Y(size.h)}`,
    `L ${X(innerStart.x)} ${Y(cy)}`,
    rInner > 0
      ? `A ${irx} ${iry} 0 0 1 ${X(cx)} ${Y(innerArcEnd.y)}`
      : `L ${X(cx)} ${Y(innerArcEnd.y)}`,
    `L ${X(innerArcEnd.x)} ${Y(innerArcEnd.y)}`,
    'Z',
  ].join(' ')
}

/** 兩個端點與半徑控制點的位置（公尺，左上原點） */
export function cornerTrackHandlesM(g: CornerTrackGeometry): {
  endIn: ShapePoint
  endOut: ShapePoint
  radius: ShapePoint
} {
  const half = g.widthM / 2
  const rOuter = g.radiusM + half
  const cx = g.legInM
  const cy = rOuter
  const size = cornerTrackSizeM(g)
  return {
    endIn: { x: 0, y: cy - g.radiusM },
    endOut: { x: cx + g.radiusM, y: size.h },
    // 半徑控制點在中心線圓弧的中點，往外拉＝半徑變大
    radius: {
      x: cx + g.radiusM * Math.SQRT1_2,
      y: cy - g.radiusM * Math.SQRT1_2,
    },
  }
}

export function readCornerTrack(
  parameters: Record<string, unknown> | undefined,
): CornerTrackGeometry {
  const raw = parameters?.[CORNER_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORNER_TRACK }
  const o = raw as Partial<CornerTrackGeometry>
  const num = (v: unknown, fallback: number, min = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback
  return {
    widthM: num(o.widthM, DEFAULT_CORNER_TRACK.widthM, 0.2),
    radiusM: num(o.radiusM, DEFAULT_CORNER_TRACK.radiusM, 0),
    legInM: num(o.legInM, DEFAULT_CORNER_TRACK.legInM),
    legOutM: num(o.legOutM, DEFAULT_CORNER_TRACK.legOutM),
    turnDeg:
      typeof o.turnDeg === 'number' && Number.isFinite(o.turnDeg)
        ? o.turnDeg
        : DEFAULT_CORNER_TRACK.turnDeg,
  }
}

export const CORNER_TRACK_KEY = 'cornerTrack'

/* ── 斜接軌道 ───────────────────────────────────────────────── */

export type TaperTrackEnd = {
  /** 端點在圖面上的位置（公尺） */
  xM: number
  yM: number
  /** 該端的軌道寬（公尺）。接合後會等於對方軌道的寬度 */
  widthM: number
  /** 已接合的軌道 id；null＝未接合 */
  attachedTrackId: string | null
}

export type TaperTrackGeometry = {
  a: TaperTrackEnd
  b: TaperTrackEnd
}

export const TAPER_TRACK_KEY = 'taperTrack'

export function defaultTaperTrack(
  centre: ShapePoint,
  lengthM = 24,
  widthM = 3.5,
): TaperTrackGeometry {
  // 預設放一個平行四邊形：兩端等寬、稍微斜著，一看就知道是用來斜接的
  const halfLen = lengthM / 2
  const offset = widthM * 1.6
  return {
    a: {
      xM: centre.x - halfLen,
      yM: centre.y - offset / 2,
      widthM,
      attachedTrackId: null,
    },
    b: {
      xM: centre.x + halfLen,
      yM: centre.y + offset / 2,
      widthM,
      attachedTrackId: null,
    },
  }
}

export function readTaperTrack(
  parameters: Record<string, unknown> | undefined,
): TaperTrackGeometry | null {
  const raw = parameters?.[TAPER_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<TaperTrackGeometry>
  const end = (e: Partial<TaperTrackEnd> | undefined): TaperTrackEnd | null => {
    if (!e || typeof e.xM !== 'number' || typeof e.yM !== 'number') return null
    return {
      xM: e.xM,
      yM: e.yM,
      widthM:
        typeof e.widthM === 'number' && Number.isFinite(e.widthM)
          ? Math.max(0.2, e.widthM)
          : 3.5,
      attachedTrackId:
        typeof e.attachedTrackId === 'string' ? e.attachedTrackId : null,
    }
  }
  const a = end(o.a)
  const b = end(o.b)
  return a && b ? { a, b } : null
}

/**
 * 斜接軌道的四個角（公尺，圖面座標）。
 *
 * 兩端各自以自己的寬度往<strong>垂直於連線方向</strong>張開。兩端寬度不同時
 * 就是一個梯形，那正是與不同寬度的軌道齊接時該有的樣子。
 */
export function taperTrackCorners(g: TaperTrackGeometry): ShapePoint[] {
  const dx = g.b.xM - g.a.xM
  const dy = g.b.yM - g.a.yM
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const ha = g.a.widthM / 2
  const hb = g.b.widthM / 2
  return [
    { x: g.a.xM + nx * ha, y: g.a.yM + ny * ha },
    { x: g.b.xM + nx * hb, y: g.b.yM + ny * hb },
    { x: g.b.xM - nx * hb, y: g.b.yM - ny * hb },
    { x: g.a.xM - nx * ha, y: g.a.yM - ny * ha },
  ]
}

export function taperTrackAabbM(g: TaperTrackGeometry): {
  xMinM: number
  yMinM: number
  xMaxM: number
  yMaxM: number
} {
  const pts = taperTrackCorners(g)
  return {
    xMinM: Math.min(...pts.map((p) => p.x)),
    yMinM: Math.min(...pts.map((p) => p.y)),
    xMaxM: Math.max(...pts.map((p) => p.x)),
    yMaxM: Math.max(...pts.map((p) => p.y)),
  }
}

/** 以 AABB 左上角為原點的填色外框 */
export function taperTrackPath(
  g: TaperTrackGeometry,
  pxPerMX: number,
  pxPerMY: number,
): string {
  const aabb = taperTrackAabbM(g)
  const pts = taperTrackCorners(g).map((p) => ({
    x: (p.x - aabb.xMinM) * pxPerMX,
    // 圖面公尺是 y 向上，畫面 y 向下
    y: (aabb.yMaxM - p.y) * pxPerMY,
  }))
  return `${pts
    .map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')} Z`
}

export function translateTaperTrack(
  g: TaperTrackGeometry,
  dxM: number,
  dyM: number,
): TaperTrackGeometry {
  return {
    a: { ...g.a, xM: g.a.xM + dxM, yM: g.a.yM + dyM },
    b: { ...g.b, xM: g.b.xM + dxM, yM: g.b.yM + dyM },
  }
}
