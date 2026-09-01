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

export type TrackGenSettings = {
  /**
   * 橫向放大倍率。
   *
   * 整體尺寸由元件大小決定（內容會自動縮到框內），所以「沿線每公尺幾像素」這種
   * 絕對比例調了也會被縮放抵銷。真正影響長相的是<strong>橫向相對沿線放大幾倍</strong>——
   * 上下行只差 3.5 公尺，不放大就會黏成一條線。
   */
  lateralScale: number
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
  lateralScale: 9,
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
  if (!Array.isArray(r.spine) || !Array.isArray(r.blocks) || !Array.isArray(r.lanes)) return null
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

export function placeSpine(
  spine: SpineSegment[],
  alongScale: number,
  cornerRadiusM: number,
): PlacedSpine {
  const out: PlacedSpine = []
  let p: Vec2 = { x: 0, y: 0 }
  let hdg = spine.find((s) => s.kind === 'straight')?.hdgDeg ?? 180

  for (const seg of spine) {
    if (seg.kind === 'straight') {
      hdg = seg.hdgDeg
      const dir = { x: Math.cos(hdg * DEG), y: -Math.sin(hdg * DEG) }
      const nrm = { x: -Math.sin(hdg * DEG), y: -Math.cos(hdg * DEG) }
      const lenPx = (seg.sTo - seg.sFrom) * alongScale
      out.push({ kind: 'straight', sFrom: seg.sFrom, sTo: seg.sTo, p0: p, dir, nrm, lenPx })
      p = { x: p.x + dir.x * lenPx, y: p.y + dir.y * lenPx }
    } else {
      const radiusPx = cornerRadiusM * alongScale
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
  // 內側半徑變小，兩條線在彎道才會保持平行
  const r = seg.radiusPx - seg.sign * lateralM * lateralScale
  return { x: seg.centre.x + (vx / m) * r, y: seg.centre.y + (vy / m) * r }
}

/** 讓彎道畫出來的弧長等於實際長度×沿線縮放，整條線比例才一致 */
export function uniformCornerRadiusM(spine: SpineSegment[]): number | null {
  const arc = spine.find((s) => s.kind === 'arc')
  if (!arc || arc.kind !== 'arc' || !arc.turnDeg) return null
  return Math.round((arc.sTo - arc.sFrom) / Math.abs(arc.turnDeg * DEG))
}
