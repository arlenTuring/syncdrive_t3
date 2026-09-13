/** 斜接等斜形軌道：場域四角點（各橫向／縱向，共八個數） */
export const REF_FIELD_CORNERS_M = 'refFieldCornersM'

export type RefFieldCornerMeters = {
  xM: number | null
  yM: number | null
}

export const REF_FIELD_CORNER_COUNT = 4

/** 與圖上四角標示一致：A→B→C→D */
export const REF_FIELD_CORNER_KEYS = ['A', 'B', 'C', 'D'] as const

export const REF_FIELD_CORNER_LABELS = REF_FIELD_CORNER_KEYS

function readOptionalNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function emptyRefFieldCorners(): RefFieldCornerMeters[] {
  return Array.from({ length: REF_FIELD_CORNER_COUNT }, () => ({
    xM: null,
    yM: null,
  }))
}

export function getRefFieldCorners(
  parameters: Record<string, unknown> | undefined,
): RefFieldCornerMeters[] {
  const raw = parameters?.[REF_FIELD_CORNERS_M]
  const out = emptyRefFieldCorners()
  if (!Array.isArray(raw)) return out
  for (let i = 0; i < REF_FIELD_CORNER_COUNT; i += 1) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    out[i] = {
      xM: readOptionalNum(o.xM),
      yM: readOptionalNum(o.yM),
    }
  }
  return out
}

export function hasValidRefFieldCorners(
  parameters: Record<string, unknown> | undefined,
): boolean {
  const corners = getRefFieldCorners(parameters)
  return corners.every(
    (c) =>
      c.xM !== null &&
      c.yM !== null &&
      Number.isFinite(c.xM) &&
      Number.isFinite(c.yM),
  )
}

/** 四個角點都有效時，算出左右上下（給定位／導通沿用舊欄位） */
export function boundsFromRefFieldCorners(
  corners: RefFieldCornerMeters[],
): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} | null {
  if (corners.length < REF_FIELD_CORNER_COUNT) return null
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const c of corners) {
    if (c.xM === null || c.yM === null) return null
    if (!Number.isFinite(c.xM) || !Number.isFinite(c.yM)) return null
    if (c.xM < xMin) xMin = c.xM
    if (c.xM > xMax) xMax = c.xM
    if (c.yM < yMin) yMin = c.yM
    if (c.yM > yMax) yMax = c.yM
  }
  if (!(xMax > xMin) || !(yMax > yMin)) return null
  return { xMinM: xMin, xMaxM: xMax, yMinM: yMin, yMaxM: yMax }
}

export function serializeRefFieldCorners(
  corners: RefFieldCornerMeters[],
): Array<{ xM: number | null; yM: number | null }> {
  return emptyRefFieldCorners().map((_, i) => ({
    xM: corners[i]?.xM ?? null,
    yM: corners[i]?.yM ?? null,
  }))
}
