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
 *   圓角軌道    等寬弧帶：外緣一條弧、內緣一條弧。四個角分別調外緣半徑、
 *               內緣半徑、與兩端直段長度
 *   斜接軌道    四邊形，兩端各自有寬度。端點吸附到別的軌道後寬度跟著對方走
 *
 * 斜接軌道兩端寬度可以不同是<strong>刻意</strong>的：接合的目的就是與對手齊寬，
 * 而兩端的對手本來就可能不一樣寬。強制等寬反而會在接縫處留下段差。
 */

export type ShapePoint = { x: number; y: number }

/* ── 圓角軌道 ───────────────────────────────────────────────── */

/**
 * 圓角軌道：四分之一橢圓的弧帶。
 *
 * 未旋轉時右邊與下面是直邊，弧從右上掃到左下——與簡報軟體那個「圓弧／派」是同
 * 一種形狀。圓角矩形做不出內側那條弧（CSS 的圓角只修外框），所以走自訂路徑。
 *
 * <h3>為什麼存比例而不是公尺</h3>
 * 三個半徑若以公尺存，元件一縮放就得同步改四個數字，少改一個形狀就走樣；而且
 * 外框大小與弧的大小會互相牽制——外弧半徑等於外框寬時就再也拉不大，看起來像
 * 控制點壞掉。改成<strong>相對外框的比例</strong>之後，外框只管大小、比例只管形狀，
 * 縮放與拖點互不干擾。
 */
export type CornerTrackGeometry = {
  /** 弧的水平半徑，佔外框寬的比例（0–1） */
  arcXRatio: number
  /** 弧的垂直半徑，佔外框高的比例（0–1） */
  arcYRatio: number
  /**
   * 內弧的水平半徑，佔外框寬的比例（0–1）。
   *
   * 與縱向<strong>分開</strong>存。共用一個「深度」時，內外半徑會同時減掉同一個公尺數；
   * 外框不是正方形的話，那條帶子就會一頭粗一頭細——實測長寬比拉開之後，轉角上緣
   * 明顯比下緣厚。分成兩個之後，右邊與下面各一個控制點各自調。
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

/** 未旋轉時的預設外框（公尺）。夠大才拖得動控制點 */
export const DEFAULT_CORNER_TRACK_SIZE_M = { w: 60, h: 60 }

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
   *
   * 圓弧做不到「拉到底變直角」——弧永遠是弧。貝茲可以：控制點推到方框角外側時
   * 曲線就貼上兩條邊，這時直接改畫兩段直線，得到真正的直角。
   *
   *   0.5   控制點在弦中點 → 直線切角
   *   1     ≈ 正圓的四分之一
   *   上限  直角
   */
  const bez = (
    px1: number, py1: number,
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

/** 斜帶兩端面的中點：a 在左邊、b 在右邊（未旋轉時） */
export function taperTrackEndsPx(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): { a: ShapePoint; b: ShapePoint } {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const d = Math.max(0, Math.min(MAX_TAPER_OFFSET, g.offsetRatio)) * h
  return {
    a: T(0, (h - d) / 2),
    b: T(w, (h + d) / 2),
  }
}

export const CORNER_TRACK_KEY = 'cornerTrack'

/* ── 斜接軌道 ───────────────────────────────────────────────── */

/**
 * 斜接軌道：矩形切掉兩個對角。
 *
 * 未旋轉時切的是<strong>右上</strong>與<strong>左下</strong>，兩條斜邊平行——這就是兩條
 * 平行股道之間換線那一段的樣子。上下兩個切角各自一個控制點，可以切得不一樣多；
 * 兩邊都切到 0 就退回矩形。
 *
 * 與圓角軌道一樣存比例而不是公尺：外框只管大小、比例只管形狀，縮放與拖點互不干擾。
 */
export type TaperTrackGeometry = {
  /**
   * 兩端的垂直錯位，佔外框高的比例（0–0.9）。0＝矩形。
   *
   * 只有<strong>一個</strong>數字：兩條斜邊本來就平行，用兩個比例去描述同一件事，
   * 使用者得拉兩次才對得起來，還可能拉成不平行的怪形狀。
   */
  offsetRatio: number
  /** 方位（度，螢幕座標順時針為正） */
  entryDeg: number
}

export const TAPER_TRACK_KEY = 'taperTrack'

export const DEFAULT_TAPER_TRACK: TaperTrackGeometry = {
  offsetRatio: 0.4,
  entryDeg: 0,
}

/** 錯位拉滿就退化成一條線，留一點餘裕 */
export const MAX_TAPER_OFFSET = 0.9

/** 未旋轉時的預設外框（公尺）。夠大才拖得動控制點 */
export const DEFAULT_TAPER_TRACK_SIZE_M = { w: 60, h: 40 }

export function readTaperTrack(
  parameters: Record<string, unknown> | undefined,
): TaperTrackGeometry {
  const raw = parameters?.[TAPER_TRACK_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TAPER_TRACK }
  const o = raw as Partial<TaperTrackGeometry> & {
    topCutRatio?: number
    bottomCutRatio?: number
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  /*
   * 舊資料存的是上下兩個切角比例。那組值描述的是同一條斜邊，取兩者平均換算過來，
   * 已經放在地圖上的斜接軌道才不會在改版後突然變回矩形。
   */
  const legacy =
    num(o.topCutRatio) !== null || num(o.bottomCutRatio) !== null
      ? 1 - ((num(o.topCutRatio) ?? 0) + (num(o.bottomCutRatio) ?? 0)) / 2
      : null
  const raw2 = num(o.offsetRatio) ?? legacy ?? DEFAULT_TAPER_TRACK.offsetRatio
  return {
    offsetRatio: Math.max(0, Math.min(MAX_TAPER_OFFSET, raw2)),
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
 * 填色外框：一個平行四邊形。
 *
 * 左端面從上緣往下，右端面往下錯開 offset；兩條斜邊平行，兩端等寬。offset 為 0
 * 時退回矩形。
 */
export function taperTrackPath(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): string {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const d = Math.max(0, Math.min(MAX_TAPER_OFFSET, g.offsetRatio)) * h
  const pts: Array<[number, number]> = [
    [0, 0],
    [w, d],
    [w, h],
    [0, h - d],
  ]
  return `${pts
    .map(([x, y], i) => {
      const p = T(x, y)
      return `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    })
    .join(' ')} Z`
}

export type TaperHandleKey = 'offset'

/** 唯一的控制點：右端面的上緣，往上下拉就改變兩端的錯位 */
export function taperTrackHandlesPx(
  g: TaperTrackGeometry,
  boxWPx: number,
  boxHPx: number,
): Record<TaperHandleKey, { x: number; y: number }> {
  const { w, h, T } = taperSpin(g, boxWPx, boxHPx)
  const d = Math.max(0, Math.min(MAX_TAPER_OFFSET, g.offsetRatio)) * h
  return { offset: T(w, d) }
}
