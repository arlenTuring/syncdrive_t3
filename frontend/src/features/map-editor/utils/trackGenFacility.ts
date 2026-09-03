import type { SpineSegment, TrackGenResult, Vec2 } from './trackGenerator'

/**
 * 軌道生成元件的參數存取與排版。
 *
 * 這個元件沿用底圖物件的搬移／縮放／選取／存檔管線，只以
 * {@link TRACKGEN_KIND_KEY} 這個參數區分身分。這樣做不必在編輯器主檔複製一整套
 * 平行的狀態管理，也就不會動到既有元件的行為。
 */

export const TRACKGEN_KIND_KEY = 'componentKind'
export const TRACKGEN_KIND_VALUE = 'trackGenerator'

export const TRACKGEN_XODR_KEY = 'trackGenXodrContent'
export const TRACKGEN_FILE_NAME_KEY = 'trackGenFileName'
export const TRACKGEN_RESULT_KEY = 'trackGenResult'
export const TRACKGEN_SETTINGS_KEY = 'trackGenSettings'
/** 這個元件上一次生成出來的 Area；重跑時取代它，不要越堆越多 */
export const TRACKGEN_AREA_ID_KEY = 'trackGenAreaId'

/**
 * 一塊軌道多大，以及代表多少路。
 *
 * 目標是用簡單明瞭的幾何表示場域，不是模擬得很像。一塊軌道畫多長多寬由使用者
 * 決定，單位是<strong>畫布像素</strong>——他在意的是「在我的畫布上這塊看起來多大」。
 */
export type TrackGenBlockSize = {
  /**
   * 軌道有多寬（畫布像素）。
   *
   * 它決定的是<strong>車輛在圖上的解析度</strong>——軌道畫粗一點，車子在上面才不會
   * 擠成一點。整體大小不受它影響：版面永遠鋪滿軌道生成元件的框，寬度變了只是每條
   * 帶子連同接上去的圓角、斜接、分岔一起變粗。
   */
  trackWidthPx: number
  /** 橫向的路，一塊代表幾公尺——只決定切幾刀，不決定大小 */
  metersPerBlockX: number
  /** 縱向的路，一塊代表幾公尺 */
  metersPerBlockY: number
}

export const TRACKGEN_BLOCK_SIZE_KEY = 'trackGenBlockSize'

export const DEFAULT_TRACKGEN_BLOCK_SIZE: TrackGenBlockSize = {
  trackWidthPx: 26,
  metersPerBlockX: 50,
  metersPerBlockY: 50,
}

export function getTrackGenBlockSize(
  parameters: Record<string, unknown> | undefined,
): TrackGenBlockSize {
  const raw = parameters?.[TRACKGEN_BLOCK_SIZE_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRACKGEN_BLOCK_SIZE }
  const o = raw as Partial<TrackGenBlockSize> & {
    metersPerBlock?: unknown
    blockWidthPx?: unknown
  }
  const n = (v: unknown, d: number, lo: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, v) : d
  // 舊資料的欄位名稱與「一塊多長」都不再用，寬度與公尺數沿用得下來
  const legacyM = n(o.metersPerBlock, DEFAULT_TRACKGEN_BLOCK_SIZE.metersPerBlockX, 1)
  const legacyW = n(o.blockWidthPx, DEFAULT_TRACKGEN_BLOCK_SIZE.trackWidthPx, 4)
  return {
    trackWidthPx: n(o.trackWidthPx, legacyW, 4),
    metersPerBlockX: n(o.metersPerBlockX, legacyM, 1),
    metersPerBlockY: n(o.metersPerBlockY, legacyM, 1),
  }
}

export type TrackGenSettings = {
  /**
   * 橫向放大倍率。
   *
   * 整體尺寸由元件大小決定（內容會自動縮到框內），所以「沿線每公尺幾像素」這種
   * 絕對比例調了也會被縮放抵銷。真正影響長相的是<strong>橫向相對沿線放大幾倍</strong>——
   * 上下行只差 3.5 公尺，不放大就會黏成一條線。
   */
  lateralScale: number
  /**
   * 軌道寬度倍率，乘在<strong>真實車道寬</strong>上。
   *
   * 先前寬度是「車道寬 × 橫向放大」，橫向放大 9 倍時 3.35 公尺的車道被畫成 30 公尺
   * 寬——一段只有 6 公尺長的軌道就變成一片橫躺的薄片。寬度與橫向間距是兩件事，
   * 分開設定。
   */
  trackWidthScale: number
  /** 彎道半徑（公尺） */
  cornerRadiusM: number
  /** 每塊目標長度（公尺） */
  blockLengthM: number
  /** 區塊標籤字級，0 表示隱藏 */
  labelSizePx: number
  showCrossovers: boolean
  showSidings: boolean
}

export const DEFAULT_TRACKGEN_SETTINGS: TrackGenSettings = {
  /*
   * 橫向與軌道寬都預設 1：直接照真實幾何畫，只有曲率被分段化。
   *
   * 先前橫向放大 9 倍是為了把上下行分開，代價是任何橫向位移都被放大九倍——
   * 一段 16 公尺長的岔線橫移 30 公尺，畫出來是一根 183 公尺寬的尖刺。要把兩條線
   * 分開請調這個值，但記得軌道寬也要跟著調，否則會變成一堆細線。
   */
  lateralScale: 1,
  trackWidthScale: 1,
  cornerRadiusM: 57,
  blockLengthM: 50,
  labelSizePx: 10,
  showCrossovers: true,
  showSidings: true,
}

export function isTrackGenComponent(parameters: Record<string, unknown> | undefined): boolean {
  return parameters?.[TRACKGEN_KIND_KEY] === TRACKGEN_KIND_VALUE
}

export function getTrackGenXodr(parameters: Record<string, unknown> | undefined): string | null {
  const raw = parameters?.[TRACKGEN_XODR_KEY]
  return typeof raw === 'string' && raw.trim() ? raw : null
}

export function getTrackGenAreaId(
  parameters: Record<string, unknown> | undefined,
): string | null {
  const raw = parameters?.[TRACKGEN_AREA_ID_KEY]
  return typeof raw === 'string' && raw ? raw : null
}

export function getTrackGenFileName(parameters: Record<string, unknown> | undefined): string | null {
  const raw = parameters?.[TRACKGEN_FILE_NAME_KEY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function getTrackGenResult(
  parameters: Record<string, unknown> | undefined,
): TrackGenResult | null {
  const raw = parameters?.[TRACKGEN_RESULT_KEY]
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<TrackGenResult>
  if (!Array.isArray(r.spine) || !Array.isArray(r.lines)) return null
  return raw as TrackGenResult
}

export function getTrackGenSettings(
  parameters: Record<string, unknown> | undefined,
): TrackGenSettings {
  const raw = parameters?.[TRACKGEN_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRACKGEN_SETTINGS }
  return { ...DEFAULT_TRACKGEN_SETTINGS, ...(raw as Partial<TrackGenSettings>) }
}

export function defaultTrackGenParameters(): Record<string, unknown> {
  return {
    [TRACKGEN_KIND_KEY]: TRACKGEN_KIND_VALUE,
    [TRACKGEN_SETTINGS_KEY]: { ...DEFAULT_TRACKGEN_SETTINGS },
  }
}

/* ── 排版 ────────────────────────────────────────────────────────
   螢幕座標 y 向下：真實航向 θ 的方向向量是 (cosθ, −sinθ)，
   行進方向左法線是 (−sinθ, −cosθ)。                              */

const DEG = Math.PI / 180

export type PlacedSpine = Array<
  | { kind: 'straight'; sFrom: number; sTo: number; p0: Vec2; dir: Vec2; nrm: Vec2; lenPx: number }
  | { kind: 'arc'; sFrom: number; sTo: number; centre: Vec2; v0: Vec2; radiusPx: number; sign: number; turnDeg: number }
>

/**
 * @param alongX 橫向的路，一公尺幾像素
 * @param alongY 縱向的路，一公尺幾像素——與橫向分開，扁畫布才塞得下
 * @param cornerRadiusPx 轉角的<strong>脊線</strong>半徑，已經是版面單位。
 *   以前吃的是公尺再乘 alongScale，於是轉角大小綁在「一塊代表幾公尺」上：使用者
 *   只是把一塊從 50 公尺改成 25，轉角就跟著脹成兩倍，而他根本沒動到轉角。
 */
/** 航向是不是橫的（脊線的航向已經吸到 90 度的倍數） */
export function isAlongX(hdgDeg: number): boolean {
  return Math.abs(Math.round(hdgDeg / 90)) % 2 === 0
}

export function placeSpine(
  spine: SpineSegment[],
  alongX: number,
  alongY: number,
  cornerRadiusPx: number,
): PlacedSpine {
  const out: PlacedSpine = []
  let p: Vec2 = { x: 0, y: 0 }
  let hdg = spine.find((s) => s.kind === 'straight')?.hdgDeg ?? 180

  for (const seg of spine) {
    if (seg.kind === 'straight') {
      hdg = seg.hdgDeg
      const dir = { x: Math.cos(hdg * DEG), y: -Math.sin(hdg * DEG) }
      const nrm = { x: -Math.sin(hdg * DEG), y: -Math.cos(hdg * DEG) }
      const lenPx = (seg.sTo - seg.sFrom) * (isAlongX(hdg) ? alongX : alongY)
      out.push({ kind: 'straight', sFrom: seg.sFrom, sTo: seg.sTo, p0: p, dir, nrm, lenPx })
      p = { x: p.x + dir.x * lenPx, y: p.y + dir.y * lenPx }
    } else {
      const radiusPx = cornerRadiusPx
      const nrm = { x: -Math.sin(hdg * DEG), y: -Math.cos(hdg * DEG) }
      const sign = seg.turnDeg > 0 ? 1 : -1
      const centre = { x: p.x + nrm.x * sign * radiusPx, y: p.y + nrm.y * sign * radiusPx }
      const v0 = { x: p.x - centre.x, y: p.y - centre.y }
      out.push({ kind: 'arc', sFrom: seg.sFrom, sTo: seg.sTo, centre, v0, radiusPx, sign, turnDeg: seg.turnDeg })
      // 真實左轉 = 螢幕順時針
      const a = -seg.turnDeg * DEG
      p = {
        x: centre.x + v0.x * Math.cos(a) - v0.y * Math.sin(a),
        y: centre.y + v0.x * Math.sin(a) + v0.y * Math.cos(a),
      }
      hdg += seg.turnDeg
    }
  }
  return out
}

/** (里程, 橫向偏移) → 排版座標 */
export function placePoint(
  s: number,
  lateralM: number,
  placed: PlacedSpine,
  lateralScale: number,
): Vec2 {
  const seg = placed.find((q) => s <= q.sTo) ?? placed[placed.length - 1]
  if (!seg) return { x: 0, y: 0 }
  if (seg.kind === 'straight') {
    const u = ((s - seg.sFrom) / Math.max(1e-6, seg.sTo - seg.sFrom)) * seg.lenPx
    return {
      x: seg.p0.x + seg.dir.x * u + seg.nrm.x * lateralM * lateralScale,
      y: seg.p0.y + seg.dir.y * u + seg.nrm.y * lateralM * lateralScale,
    }
  }
  const u = Math.max(0, Math.min(1, (s - seg.sFrom) / Math.max(1e-6, seg.sTo - seg.sFrom)))
  const a = -seg.turnDeg * DEG * u
  const vx = seg.v0.x * Math.cos(a) - seg.v0.y * Math.sin(a)
  const vy = seg.v0.x * Math.sin(a) + seg.v0.y * Math.cos(a)
  const m = Math.hypot(vx, vy) || 1
  /*
   * 內側半徑變小，兩條線在彎道才會保持平行。
   *
   * 半徑要夾在正值：離主線三股的側線橫向偏移比彎道半徑還大，不夾的話半徑變負，
   * 點會穿過圓心鏡射到另一邊——畫面上就是一條從轉角斜刺出去的帶子。
   */
  const r = Math.max(
    seg.radiusPx * 0.15,
    seg.radiusPx - seg.sign * lateralM * lateralScale,
  )
  return { x: seg.centre.x + (vx / m) * r, y: seg.centre.y + (vy / m) * r }
}

/** 讓彎道畫出來的弧長等於實際長度×沿線縮放，整條線比例才一致 */
export function uniformCornerRadiusM(spine: SpineSegment[]): number | null {
  const arc = spine.find((s) => s.kind === 'arc')
  if (!arc || arc.kind !== 'arc' || !arc.turnDeg) return null
  return Math.round((arc.sTo - arc.sFrom) / Math.abs(arc.turnDeg * DEG))
}
