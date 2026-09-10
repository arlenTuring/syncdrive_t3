
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
  labelSizePx: 16,
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

/** 生成後留下的摘要，給屬性欄顯示，也讓「重新生成」知道上一次生成過 */
export type TrackGenSummary = {
  nodes: number
  edges: number
  components: number
  lanes: number
  totalM: number
}

export function getTrackGenSummary(
  parameters: Record<string, unknown> | undefined,
): TrackGenSummary | null {
  const raw = parameters?.[TRACKGEN_RESULT_KEY]
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<TrackGenSummary>
  if (typeof r.edges !== 'number' || typeof r.nodes !== 'number') return null
  return {
    nodes: r.nodes,
    edges: r.edges,
    components: r.components ?? 1,
    lanes: r.lanes ?? 0,
    totalM: r.totalM ?? 0,
  }
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
