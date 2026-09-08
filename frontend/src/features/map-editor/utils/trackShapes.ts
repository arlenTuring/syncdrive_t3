/**
 * 圓角軌道與斜接軌道的幾何。
 */

export type ShapePoint = { x: number; y: number }

/* ── 圓角軌道 ───────────────────────────────────────────────── */

/**
 * 圓角軌道：四分之一橢圓的弧帶。
 */
export type CornerTrackGeometry = {
  /** 弧的水平半徑，佔外框寬的比例（0–1） */
  arcXRatio: number
  /** 弧的垂直半徑，佔外框高的比例（0–1） */
  arcYRatio: number
  /**
   * 內弧的水平半徑，佔外框寬的比例（0–1）。
   */
  innerXRatio: number
  /** 內弧的垂直半徑，佔外框高的比例（0–1） */
  innerYRatio: number
  /**
   * 外弧彎度。0.5＝直線切角，1≈正圓，拉到上限＝直角。
   *
   * 兩個端點由 arcXRatio／arcYRatio 決定，不受這個值影響。
   */
  outerBulge: number
  /**
   * 內弧彎度，與外弧<strong>各自獨立</strong>。
   *
   * 兩條弧共用一個彎度的話，調外弧會把內弧一起帶著跑——那不是使用者的意思，
   * 他要的是各調各的。
   */
  innerBulge: number
  /** 方位（度，螢幕座標順時針為正）。0＝直邊在右與下 */
  entryDeg: number
}

export const DEFAULT_CORNER_TRACK: CornerTrackGeometry = {
  arcXRatio: 1,
  arcYRatio: 1,
  innerXRatio: 0.7,
  innerYRatio: 0.7,
  outerBulge: 1,
  innerBulge: 1,
  entryDeg: 0,
}

/** 0.5＝兩端點連成直線的切角 */
export const MIN_CORNER_BULGE = 0.5
/** 到達上限就直接畫成直角，不再用曲線逼近 */
export const MAX_CORNER_BULGE = 2.4

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * 把「未旋轉」的形狀座標搬到實際的元件座標。
 *
 * entryDeg 量化到 90 度的倍數：轉 90 度時形狀的寬高互換，所以先在未旋轉的
 * 座標系裡算，最後才轉過去。圓角與斜接共用同一套慣例，排版才有辦法對位。
 */
function cornerSpin(g: Pick<CornerTrackGeometry, 'entryDeg'>, boxWPx: number, boxHPx: number) {
  const quarter = Math.round((((g.entryDeg % 360) + 360) % 360) / 90) & 3
  const swap = quarter % 2 === 1
  const w = Math.max(1, swap ? boxHPx : boxWPx)
  const h = Math.max(1, swap ? boxWPx : boxHPx)
  const cx = w / 2
  const cy = h / 2
  const ocx = boxWPx / 2
  const ocy = boxHPx / 2
  const T = (x: number, y: number) => {
    let dx = x - cx
    let dy = y - cy
    for (let i = 0; i < quarter; i += 1) {
      const nx = -dy
      const ny = dx
      dx = nx
      dy = ny
    }
    return { x: ocx + dx, y: ocy + dy }
  }
  return { w, h, T }
}

/**
 * 弧帶的填色外框。
 *
 * 直接以元件的像素尺寸產生，所以拖曳邊角改變大小時形狀跟著等比變化。
 * 弧的圓心在右下角；內弧半徑各減去帶寬，帶寬達到半徑時就不畫內弧。
 */
export function cornerTrackPath(
  g: CornerTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): string {
  const { w, h, T } = cornerSpin(g, boxWPx, boxHPx)

  const rx = Math.max(0.5, clamp01(g.arcXRatio) * w)
  const ry = Math.max(0.5, clamp01(g.arcYRatio) * h)
  // 內弧的兩個半徑各自算，帶子在非正方形的外框裡才會兩端等厚
  const irx = Math.min(rx, clamp01(g.innerXRatio) * w)
  const iry = Math.min(ry, clamp01(g.innerYRatio) * h)
  const solid = irx <= 0.5 || iry <= 0.5

  const P = (x: number, y: number) => {
    const p = T(x, y)
    return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  }

  /*
   * 弧用二次貝茲曲線畫，控制點沿著「弦中點 → 方框角」這條對角線移動。
   */
  const bez = (
    // 起點只是為了讓呼叫端寫起來成對，路徑本身接續前一段，用不到
    _px1: number, _py1: number,
    px2: number, py2: number,
    ax: number, ay: number,
    q: number,
    cornerX: number, cornerY: number,
  ): string => {
    if (q >= MAX_CORNER_BULGE - 1e-6) {
      return `L ${P(cornerX, cornerY)} L ${P(px2, py2)}`
    }
    return `Q ${P(ax - (ax - cornerX) * (q - 0.5) * 2, ay - (ay - cornerY) * (q - 0.5) * 2)} ${P(px2, py2)}`
  }

  const qOuter = Math.max(MIN_CORNER_BULGE, Math.min(MAX_CORNER_BULGE, g.outerBulge || 1))
  const qInner = Math.max(MIN_CORNER_BULGE, Math.min(MAX_CORNER_BULGE, g.innerBulge || 1))
  // 弦中點與方框角：控制點就在這兩點的連線上
  const oMidX = w - rx / 2
  const oMidY = h - ry / 2
  const oCorX = w - rx
  const oCorY = h - ry
  const iMidX = w - irx / 2
  const iMidY = h - iry / 2
  const iCorX = w - irx
  const iCorY = h - iry

  if (solid) {
    return [
      `M ${P(w, h)}`,
      `L ${P(w, h - ry)}`,
      bez(w, h - ry, w - rx, h, oMidX, oMidY, qOuter, oCorX, oCorY),
      'Z',
    ].join(' ')
  }
  return [
    `M ${P(w, h - ry)}`,
    bez(w, h - ry, w - rx, h, oMidX, oMidY, qOuter, oCorX, oCorY),
    `L ${P(w - irx, h)}`,
    // 內弧反向走：從下邊回到右邊
    (() => {
      if (qInner >= MAX_CORNER_BULGE - 1e-6) {
        return `L ${P(iCorX, iCorY)} L ${P(w, h - iry)}`
      }
      const cx2 = iMidX - (iMidX - iCorX) * (qInner - 0.5) * 2
      const cy2 = iMidY - (iMidY - iCorY) * (qInner - 0.5) * 2
      return `Q ${P(cx2, cy2)} ${P(w, h - iry)}`
    })(),
    'Z',
  ].join(' ')
}

export type CornerHandleKey = 'arcY' | 'arcX' | 'innerY' | 'innerX' | 'outer' | 'inner'

/**
 * 四個控制點（像素，相對元件左上角）。
 *
 * 兩個落在弧與直邊的交點上，另外兩個落在外弧與內弧的中點——位置就在它所控制
 * 的那條線上。
 */
export function cornerTrackHandlesPx(
  g: CornerTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<CornerHandleKey, { x: number; y: number }> {
  const { w, h, T } = cornerSpin(g, boxWPx, boxHPx)
  const rx = clamp01(g.arcXRatio) * w
  const ry = clamp01(g.arcYRatio) * h
  const irx = Math.min(rx, clamp01(g.innerXRatio) * w)
  const iry = Math.min(ry, clamp01(g.innerYRatio) * h)
  /*
   * 控制點放在曲線的中點上。二次貝茲在 t=0.5 的位置是 (P1 + 2Q + P2)/4，
   * 代入控制點的定義後化簡，中點離圓心的比例正好是 (2q + 1)/4——
   * q=0.5 時 0.5（弦中點）、q=1 時 0.75（≈正圓）、拉到上限就是方框角。
   */
  const qO = Math.max(MIN_CORNER_BULGE, Math.min(MAX_CORNER_BULGE, g.outerBulge || 1))
  const qI = Math.max(MIN_CORNER_BULGE, Math.min(MAX_CORNER_BULGE, g.innerBulge || 1))
  const frac = (q: number) => (q >= MAX_CORNER_BULGE - 1e-6 ? 1 : (2 * q + 1) / 4)
  const fo = frac(qO)
  const fi = frac(qI)
  return {
    arcY: T(w, h - ry),
    arcX: T(w - rx, h),
    innerY: T(w, h - iry),
    innerX: T(w - irx, h),
    outer: T(w - rx * fo, h - ry * fo),
    inner: T(w - irx * fi, h - iry * fi),
  }
}

/** 舊資料的 depthRatio → 兩個內半徑比例 */
function legacyInner(
  o: Partial<CornerTrackGeometry> & { depthRatio?: number },
  axis: 'x' | 'y',
): number | undefined {
  const d = o.depthRatio
  if (typeof d !== 'number' || !Number.isFinite(d)) return undefined
  const outer =
    (axis === 'x' ? o.arcXRatio : o.arcYRatio) ??
    (axis === 'x' ? DEFAULT_CORNER_TRACK.arcXRatio : DEFAULT_CORNER_TRACK.arcYRatio)
  return outer * (1 - Math.max(0, Math.min(1, d)))
}

export function readCornerTrack(
  parameters: Record<string, unknown> | undefined,
): CornerTrackGeometry {
  const raw = parameters?.[CORNER_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORNER_TRACK }
  const o = raw as Partial<CornerTrackGeometry> & { depthRatio?: number }
  const ratio = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback
  const bulge = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(MIN_CORNER_BULGE, Math.min(MAX_CORNER_BULGE, v))
      : fallback
  return {
    arcXRatio: ratio(o.arcXRatio, DEFAULT_CORNER_TRACK.arcXRatio),
    arcYRatio: ratio(o.arcYRatio, DEFAULT_CORNER_TRACK.arcYRatio),
    /*
     * 舊資料只存一個 depthRatio（內半徑＝外半徑減掉同一個深度）。等比換算成兩個
     * 比例，已經放在地圖上的轉角改版後才不會突然變形。
     */
    innerXRatio: ratio(
      o.innerXRatio ?? legacyInner(o, 'x'),
      DEFAULT_CORNER_TRACK.innerXRatio,
    ),
    innerYRatio: ratio(
      o.innerYRatio ?? legacyInner(o, 'y'),
      DEFAULT_CORNER_TRACK.innerYRatio,
    ),
    outerBulge: bulge(o.outerBulge, DEFAULT_CORNER_TRACK.outerBulge),
    innerBulge: bulge(o.innerBulge, DEFAULT_CORNER_TRACK.innerBulge),
    entryDeg:
      typeof o.entryDeg === 'number' && Number.isFinite(o.entryDeg) ? o.entryDeg : 0,
  }
}

/* ── 幾何錨點：排版對位用 ─────────────────────────────────────
   生成軌道時必須知道「畫出來的那一段，兩端到底落在哪」。以前排版自己推一次、
   元件再畫一次，兩邊的角度慣例一不一致就會整段偏掉——實際發生過：轉角整個
   平移了一個外框的距離。錨點統一由這裡算，排版與繪製就不可能各說各話。   */

/** 弧的圓心（相對元件左上角的像素）。未旋轉時在方框右下角 */
export function cornerArcCentrePx(
  entryDeg: number,
  boxWPx: number,
  boxHPx: number,
): ShapePoint {
  const { w, h, T } = cornerSpin({ entryDeg }, boxWPx, boxHPx)
  return T(w, h)
}

/**
 * 弧帶兩端的中點。
 *
 * a 落在「直邊在右」的那一側，b 落在「直邊在下」的那一側；行進方向由哪一端進
 * 由排版決定，這裡只回傳位置。
 */
export function cornerTrackEndsPx(
  g: CornerTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: ShapePoint; b: ShapePoint } {
  const { w, h, T } = cornerSpin(g, boxWPx, boxHPx)
  const rx = Math.max(0.5, clamp01(g.arcXRatio) * w)
  const ry = Math.max(0.5, clamp01(g.arcYRatio) * h)
  const irx = Math.min(rx, clamp01(g.innerXRatio) * w)
  const iry = Math.min(ry, clamp01(g.innerYRatio) * h)
  return {
    a: T(w, h - (ry + iry) / 2),
    b: T(w - (rx + irx) / 2, h),
  }
}

/**
 * 弧帶兩端<strong>整條端面</strong>的線段（相對元件左上角的像素）。
 */
export function cornerTrackEndSegmentsPx(
  g: CornerTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: [ShapePoint, ShapePoint]; b: [ShapePoint, ShapePoint] } {
  const { w, h, T } = cornerSpin(g, boxWPx, boxHPx)
  const rx = Math.max(0.5, clamp01(g.arcXRatio) * w)
  const ry = Math.max(0.5, clamp01(g.arcYRatio) * h)
  const irx = Math.min(rx, clamp01(g.innerXRatio) * w)
  const iry = Math.min(ry, clamp01(g.innerYRatio) * h)
  return {
    a: [T(w, h - ry), T(w, h - iry)],
    b: [T(w - rx, h), T(w - irx, h)],
  }
}

/** 斜帶兩端面的中點：a 在左邊、b 在右邊（未旋轉時） */
export function taperTrackEndsPx(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: ShapePoint; b: ShapePoint } {
  return taperTrackHandlesPx(g, boxWPx, boxHPx)
}

export const CORNER_TRACK_KEY = 'cornerTrack'

/* ── 斜接軌道 ───────────────────────────────────────────────── */

/**
 * 斜接軌道：矩形切掉兩個對角。
 */
/**
 * 斜接軌道：兩個端面 ＋ 兩條連接邊。
 */
export type TaperTrackGeometry = {
  /** 左端面的起點，佔外框高的比例 */
  aFrom: number
  /** 左端面的終點 */
  aTo: number
  /** 右端面的起點 */
  bFrom: number
  /** 右端面的終點 */
  bTo: number
  /** 方位（度，螢幕座標順時針為正） */
  entryDeg: number
}

export const TAPER_TRACK_KEY = 'taperTrack'

export const DEFAULT_TAPER_TRACK: TaperTrackGeometry = {
  aFrom: 0,
  aTo: 0.6,
  bFrom: 0.4,
  bTo: 1,
  entryDeg: 0,
}

export function readTaperTrack(
  parameters: Record<string, unknown> | undefined,
): TaperTrackGeometry {
  const raw = parameters?.[TAPER_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TAPER_TRACK }
  const o = raw as Partial<TaperTrackGeometry> & {
    offsetRatio?: number
    topCutRatio?: number
    bottomCutRatio?: number
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const clamp = (v: number) => Math.max(0, Math.min(1, v))

  if (num(o.aFrom) !== null && num(o.bTo) !== null) {
    return {
      aFrom: clamp(o.aFrom!),
      aTo: clamp(num(o.aTo) ?? DEFAULT_TAPER_TRACK.aTo),
      bFrom: clamp(num(o.bFrom) ?? DEFAULT_TAPER_TRACK.bFrom),
      bTo: clamp(o.bTo!),
      entryDeg: num(o.entryDeg) ?? 0,
    }
  }

  /*
   * 舊資料換算：一個錯位比例的平行四邊形，或再更早的上下兩個切角比例。已經放在
   * 地圖上的斜接軌道改版後才不會突然變形。
   */
  const legacyCut =
    num(o.topCutRatio) !== null || num(o.bottomCutRatio) !== null
      ? 1 - ((num(o.topCutRatio) ?? 0) + (num(o.bottomCutRatio) ?? 0)) / 2
      : null
  const d = clamp(num(o.offsetRatio) ?? legacyCut ?? 0.4)
  return {
    aFrom: 0,
    aTo: clamp(1 - d),
    bFrom: d,
    bTo: 1,
    entryDeg: num(o.entryDeg) ?? 0,
  }
}

function taperSpin(g: TaperTrackGeometry, boxWPx: number, boxHPx: number) {
  const quarter = Math.round((((g.entryDeg % 360) + 360) % 360) / 90) & 3
  const swap = quarter % 2 === 1
  const w = Math.max(1, swap ? boxHPx : boxWPx)
  const h = Math.max(1, swap ? boxWPx : boxHPx)
  const cx = w / 2
  const cy = h / 2
  const ocx = boxWPx / 2
  const ocy = boxHPx / 2
  const T = (x: number, y: number) => {
    let dx = x - cx
    let dy = y - cy
    for (let i = 0; i < quarter; i += 1) {
      const nx = -dy
      const ny = dx
      dx = nx
      dy = ny
    }
    return { x: ocx + dx, y: ocy + dy }
  }
  return { w, h, T }
}

/**
 * 填色外框：左端面 → 右端面 → 回來，一個四邊形。
 *
 * 兩端面都是垂直線段（未旋轉時），所以與軸對齊的軌道邊天生對得齊；長度各自獨立，
 * 因此可以是梯形。
 */
export function taperTrackPath(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): string {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const pts: Array<[number, number]> = [
    [0, c(g.aFrom)],
    [w, c(g.bFrom)],
    [w, c(g.bTo)],
    [0, c(g.aTo)],
  ]
  return `${pts
    .map(([x, y], i) => {
      const p = T(x, y)
      return `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    })
    .join(' ')} Z`
}

export type TaperHandleKey = 'a' | 'b'

/**
 * 兩個端點小點，各在一個端面的中央。
 *
 * 拖它們去碰要接的軌道邊；碰到就吸附、放手就接合並與對手齊寬。不去碰任何東西時
 * 就只是把那個端面移到指標的位置。
 */
export function taperTrackHandlesPx(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<TaperHandleKey, { x: number; y: number }> {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  return {
    a: T(0, (c(g.aFrom) + c(g.aTo)) / 2),
    b: T(w, (c(g.bFrom) + c(g.bTo)) / 2),
  }
}

/** 兩個端面的線段（相對元件左上角的像素） */
export function taperTrackEndSegmentsPx(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: [ShapePoint, ShapePoint]; b: [ShapePoint, ShapePoint] } {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  return {
    a: [T(0, c(g.aFrom)), T(0, c(g.aTo))],
    b: [T(w, c(g.bFrom)), T(w, c(g.bTo))],
  }
}

/* ── 分岔軌道 ────────────────────────────────────────────────────
   一進兩出：一條軌道分成直行與岔出兩條。斜接軌道只能表示「整條線平移過去」，
   表達不了「主線繼續、同時分出一條」——生成時只好讓兩條線在路口各畫各的，結果
   互相穿透。實測 T3 的路口區，六段斜接就製造了四萬多平方像素的跨線重疊。      */

export type SwitchTrackGeometry = {
  /** 進口面的起點，佔外框高的比例 */
  aFrom: number
  /** 進口面的終點 */
  aTo: number
  /** 直行出口面的起點 */
  mFrom: number
  /** 直行出口面的終點 */
  mTo: number
  /** 岔出出口面的起點 */
  bFrom: number
  /** 岔出出口面的終點 */
  bTo: number
  /**
   * 直行出口<strong>伸多遠</strong>，佔外框長邊的比例（0–1）。
   */
  mAt: number
  /** 岔出出口伸多遠，佔外框長邊的比例（0–1） */
  bAt: number
  /** 方位（度，螢幕座標順時針為正） */
  entryDeg: number
}

export const SWITCH_TRACK_KEY = 'switchTrack'

export const DEFAULT_SWITCH_TRACK: SwitchTrackGeometry = {
  aFrom: 0,
  aTo: 0.34,
  mFrom: 0,
  mTo: 0.34,
  bFrom: 0.66,
  bTo: 1,
  mAt: 1,
  bAt: 1,
  entryDeg: 0,
}

export function readSwitchTrack(
  parameters: Record<string, unknown> | undefined,
): SwitchTrackGeometry {
  const raw = parameters?.[SWITCH_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SWITCH_TRACK }
  const o = raw as Partial<SwitchTrackGeometry>
  const num = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d
  return {
    aFrom: num(o.aFrom, DEFAULT_SWITCH_TRACK.aFrom),
    aTo: num(o.aTo, DEFAULT_SWITCH_TRACK.aTo),
    mFrom: num(o.mFrom, DEFAULT_SWITCH_TRACK.mFrom),
    mTo: num(o.mTo, DEFAULT_SWITCH_TRACK.mTo),
    bFrom: num(o.bFrom, DEFAULT_SWITCH_TRACK.bFrom),
    bTo: num(o.bTo, DEFAULT_SWITCH_TRACK.bTo),
    // 舊資料沒有這兩個欄位，當成兩個出口都伸到底——那正是先前的行為
    mAt: num(o.mAt, DEFAULT_SWITCH_TRACK.mAt),
    bAt: num(o.bAt, DEFAULT_SWITCH_TRACK.bAt),
    entryDeg:
      typeof o.entryDeg === 'number' && Number.isFinite(o.entryDeg)
        ? o.entryDeg
        : DEFAULT_SWITCH_TRACK.entryDeg,
  }
}

function switchSpin(g: SwitchTrackGeometry, boxWPx: number, boxHPx: number) {
  const quarter = Math.round((((g.entryDeg % 360) + 360) % 360) / 90) & 3
  const swap = quarter % 2 === 1
  const w = Math.max(1, swap ? boxHPx : boxWPx)
  const h = Math.max(1, swap ? boxWPx : boxHPx)
  const cx = w / 2
  const cy = h / 2
  const ocx = boxWPx / 2
  const ocy = boxHPx / 2
  const T = (x: number, y: number) => {
    let dx = x - cx
    let dy = y - cy
    for (let i = 0; i < quarter; i += 1) {
      const nx = -dy
      const ny = dx
      dx = nx
      dy = ny
    }
    return { x: ocx + dx, y: ocy + dy }
  }
  return { w, h, T }
}

/**
 * 填色外框：兩個四邊形共用同一個進口面。
 */
export function switchTrackPath(
  g: SwitchTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): string {
  const { w, h, T } = switchSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const at = (v: number) => Math.max(0, Math.min(1, v)) * w
  // 兩條腿各伸各的：出口那一面的位置由自己的 mAt／bAt 決定，不是一律貼著外框邊
  const quad = (x: number, y0: number, y1: number) =>
    [
      [0, c(g.aFrom)],
      [x, y0],
      [x, y1],
      [0, c(g.aTo)],
    ]
      .map(([px, py], i) => {
        const p = T(px as number, py as number)
        return `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
      })
      .join(' ') + ' Z'
  return `${quad(at(g.mAt), c(g.mFrom), c(g.mTo))} ${quad(at(g.bAt), c(g.bFrom), c(g.bTo))}`
}

/**
 * 直行那一片與岔出那一片<strong>各自的</strong>外框。
 *
 * 分岔在圖上是一個元件，現場卻是兩條路：橫的那條是主線繼續走、斜的那條岔出去。
 * 要分開選、分開命名就得分開拿得到。
 */
export function switchTrackPartPaths(
  g: SwitchTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { straight: string; branch: string } {
  const { w, h, T } = switchSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const at = (v: number) => Math.max(0, Math.min(1, v)) * w
  const quad = (x: number, y0: number, y1: number) =>
    [
      [0, c(g.aFrom)],
      [x, y0],
      [x, y1],
      [0, c(g.aTo)],
    ]
      .map(([px, py], i) => {
        const p = T(px as number, py as number)
        return `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
      })
      .join(' ') + ' Z'
  return {
    straight: quad(at(g.mAt), c(g.mFrom), c(g.mTo)),
    branch: quad(at(g.bAt), c(g.bFrom), c(g.bTo)),
  }
}

/** 進口 a、直行出口 m、岔出出口 b */
export type SwitchHandleKey = 'a' | 'm' | 'b'

export function switchTrackHandlesPx(
  g: SwitchTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<SwitchHandleKey, { x: number; y: number }> {
  const { w, h, T } = switchSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const at = (v: number) => Math.max(0, Math.min(1, v)) * w
  return {
    a: T(0, (c(g.aFrom) + c(g.aTo)) / 2),
    m: T(at(g.mAt), (c(g.mFrom) + c(g.mTo)) / 2),
    b: T(at(g.bAt), (c(g.bFrom) + c(g.bTo)) / 2),
  }
}

/** 直行與岔出各自的中心（相對元件左上角的像素）——名字標在自己那條上 */
export function switchTrackPartCentresPx(
  g: SwitchTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { straight: ShapePoint; branch: ShapePoint } {
  const { w, h, T } = switchSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const at = (v: number) => Math.max(0, Math.min(1, v)) * w
  const mid = (x: number, y0: number, y1: number) =>
    T((0 + x) / 2, (c(g.aFrom) + c(g.aTo) + y0 + y1) / 4)
  return {
    straight: mid(at(g.mAt), c(g.mFrom), c(g.mTo)),
    branch: mid(at(g.bAt), c(g.bFrom), c(g.bTo)),
  }
}

/** 三個端面的線段（相對元件左上角的像素） */
export function switchTrackEndSegmentsPx(
  g: SwitchTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: [ShapePoint, ShapePoint]; m: [ShapePoint, ShapePoint]; b: [ShapePoint, ShapePoint] } {
  const { w, h, T } = switchSpin(g, boxWPx, boxHPx)
  const c = (v: number) => Math.max(0, Math.min(1, v)) * h
  const at = (v: number) => Math.max(0, Math.min(1, v)) * w
  return {
    a: [T(0, c(g.aFrom)), T(0, c(g.aTo))],
    m: [T(at(g.mAt), c(g.mFrom)), T(at(g.mAt), c(g.mTo))],
    b: [T(at(g.bAt), c(g.bFrom)), T(at(g.bAt), c(g.bTo))],
  }
}

/* ── 交叉軌道 ────────────────────────────────────────────────────
   兩條軌道在這裡交會，四個口<strong>互相都通</strong>：左上可以直行去右上，也可以
   斜過去右下；左下同理。所以路徑有四條，不是兩條——本體畫的是兩條直行的軌道，兩條
   斜的用虛線疊在上面，交錯的關係才看得出來。

   渡線做的是類似的事，但它是在還沒有分岔軌道的年代做的：只能表達「兩條平行線之間
   換過去」，接口也不是可以拉去接別人的連接點。                              */

/** 一個端面：在長邊的哪個位置（at），跨過短邊的哪一段（from–to） */
export type CrossFace = { at: number; from: number; to: number }

export type CrossTrackGeometry = {
  /** 左上端面 */
  lt: CrossFace
  /** 左下端面 */
  lb: CrossFace
  /** 右上端面 */
  rt: CrossFace
  /** 右下端面 */
  rb: CrossFace
  /** 方位（度，螢幕座標順時針為正） */
  entryDeg: number
}

export const CROSS_TRACK_KEY = 'crossTrack'

/**
 * 預設就是兩條各佔一半、交叉滿整個外框。
 *
 * 四個端面各佔短邊的一半，兩條帶子因此鋪滿外框——這是交叉軌道最好認的樣子。
 * 要細一點的帶子，把端面拉窄就是了。
 */
export const DEFAULT_CROSS_TRACK: CrossTrackGeometry = {
  lt: { at: 0, from: 0, to: 0.5 },
  lb: { at: 0, from: 0.5, to: 1 },
  rt: { at: 1, from: 0, to: 0.5 },
  rb: { at: 1, from: 0.5, to: 1 },
  entryDeg: 0,
}

export function readCrossTrack(
  parameters: Record<string, unknown> | undefined,
): CrossTrackGeometry {
  const raw = parameters?.[CROSS_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return structuredCloneCross(DEFAULT_CROSS_TRACK)
  const o = raw as Partial<Record<keyof CrossTrackGeometry, unknown>>
  const num = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d
  const face = (v: unknown, d: CrossFace): CrossFace => {
    if (!v || typeof v !== 'object') return { ...d }
    const f = v as Partial<CrossFace>
    return { at: num(f.at, d.at), from: num(f.from, d.from), to: num(f.to, d.to) }
  }
  return {
    lt: face(o.lt, DEFAULT_CROSS_TRACK.lt),
    lb: face(o.lb, DEFAULT_CROSS_TRACK.lb),
    rt: face(o.rt, DEFAULT_CROSS_TRACK.rt),
    rb: face(o.rb, DEFAULT_CROSS_TRACK.rb),
    entryDeg:
      typeof o.entryDeg === 'number' && Number.isFinite(o.entryDeg)
        ? o.entryDeg
        : DEFAULT_CROSS_TRACK.entryDeg,
  }
}

function structuredCloneCross(g: CrossTrackGeometry): CrossTrackGeometry {
  return { lt: { ...g.lt }, lb: { ...g.lb }, rt: { ...g.rt }, rb: { ...g.rb }, entryDeg: g.entryDeg }
}

function crossSpin(g: CrossTrackGeometry, boxWPx: number, boxHPx: number) {
  const quarter = Math.round((((g.entryDeg % 360) + 360) % 360) / 90) & 3
  const swap = quarter % 2 === 1
  const w = Math.max(1, swap ? boxHPx : boxWPx)
  const h = Math.max(1, swap ? boxWPx : boxHPx)
  const cx = w / 2
  const cy = h / 2
  const ocx = boxWPx / 2
  const ocy = boxHPx / 2
  const T = (x: number, y: number) => {
    let dx = x - cx
    let dy = y - cy
    for (let i = 0; i < quarter; i += 1) {
      const nx = -dy
      const ny = dx
      dx = nx
      dy = ny
    }
    return { x: ocx + dx, y: ocy + dy }
  }
  return { w, h, T }
}

function bandPath(
  p: CrossFace,
  q: CrossFace,
  w: number,
  h: number,
  T: (x: number, y: number) => ShapePoint,
): string {
  return (
    [
      [p.at * w, p.from * h],
      [q.at * w, q.from * h],
      [q.at * w, q.to * h],
      [p.at * w, p.to * h],
    ]
      .map(([px, py], i) => {
        const t = T(px as number, py as number)
        return `${i ? 'L' : 'M'} ${t.x.toFixed(2)} ${t.y.toFixed(2)}`
      })
      .join(' ') + ' Z'
  )
}

/**
 * 本體是<strong>兩條直行的軌道</strong>：左上到右上、左下到右下。
 */
export function crossTrackPath(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): string {
  const p = crossTrackPartPaths(g, boxWPx, boxHPx)
  return `${p.up} ${p.down}`
}

/**
 * 兩條直行<strong>各自的</strong>外框。
 *
 * 交叉在圖上是一個元件，但現場是兩條軌道——上行一條、下行一條。要分開選、分開命名、
 * 分開上色就得分開拿得到，所以兩片各給一個。
 */
export function crossTrackPartPaths(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { up: string; down: string } {
  const { w, h, T } = crossSpin(g, boxWPx, boxHPx)
  return {
    up: bandPath(g.lt, g.rt, w, h, T),
    down: bandPath(g.lb, g.rb, w, h, T),
  }
}

/**
 * 疊在本體上的線：兩條斜行路徑的邊，加上兩條直行之間的分隔。
 *
 * 四條虛線就是兩條斜的帶子各自的兩條邊——交錯的關係得畫出來，不然使用者看到的只是
 * 一個灰色方塊，看不出這裡可以斜著過去。
 */
export function crossTrackGuidesPx(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): {
  /** 斜行路徑的邊，每條斜的兩條，共四條 */
  diagonals: Array<[ShapePoint, ShapePoint]>
  /** 兩條直行之間的分隔線 */
  divider: [ShapePoint, ShapePoint]
} {
  const { w, h, T } = crossSpin(g, boxWPx, boxHPx)
  const P = (f: CrossFace, v: number) => T(f.at * w, v * h)
  const edge = (p: CrossFace, q: CrossFace): Array<[ShapePoint, ShapePoint]> => [
    [P(p, p.from), P(q, q.from)],
    [P(p, p.to), P(q, q.to)],
  ]
  const mid = (a: ShapePoint, b: ShapePoint): ShapePoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })
  return {
    diagonals: [...edge(g.lt, g.rb), ...edge(g.lb, g.rt)],
    divider: [
      mid(P(g.lt, g.lt.to), P(g.lb, g.lb.from)),
      mid(P(g.rt, g.rt.to), P(g.rb, g.rb.from)),
    ],
  }
}

/** 兩條直行各自的中心（相對元件左上角的像素）——名字標在自己那條上 */
export function crossTrackPartCentresPx(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { up: ShapePoint; down: ShapePoint } {
  const { w, h, T } = crossSpin(g, boxWPx, boxHPx)
  const mid = (p: CrossFace, q: CrossFace) =>
    T(((p.at + q.at) / 2) * w, ((p.from + p.to + q.from + q.to) / 4) * h)
  return { up: mid(g.lt, g.rt), down: mid(g.lb, g.rb) }
}

export type CrossHandleKey = 'lt' | 'lb' | 'rt' | 'rb'

export const CROSS_HANDLE_KEYS: CrossHandleKey[] = ['lt', 'lb', 'rt', 'rb']

export function crossTrackHandlesPx(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<CrossHandleKey, { x: number; y: number }> {
  const { w, h, T } = crossSpin(g, boxWPx, boxHPx)
  const mid = (f: CrossFace) => T(f.at * w, ((f.from + f.to) / 2) * h)
  return { lt: mid(g.lt), lb: mid(g.lb), rt: mid(g.rt), rb: mid(g.rb) }
}

/** 四個端面的線段（相對元件左上角的像素） */
export function crossTrackEndSegmentsPx(
  g: CrossTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<CrossHandleKey, [ShapePoint, ShapePoint]> {
  const { w, h, T } = crossSpin(g, boxWPx, boxHPx)
  const seg = (f: CrossFace): [ShapePoint, ShapePoint] => [
    T(f.at * w, f.from * h),
    T(f.at * w, f.to * h),
  ]
  return { lt: seg(g.lt), lb: seg(g.lb), rt: seg(g.rt), rb: seg(g.rb) }
}
