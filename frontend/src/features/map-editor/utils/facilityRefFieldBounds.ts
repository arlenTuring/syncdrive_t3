/** 元件 parameters 內「場域範圍」欄位（公尺，場域座標系） */
export const REF_FIELD_X_MIN_M = 'refFieldXMinM'
export const REF_FIELD_X_MAX_M = 'refFieldXMaxM'
export const REF_FIELD_Y_MIN_M = 'refFieldYMinM'
export const REF_FIELD_Y_MAX_M = 'refFieldYMaxM'

export type RefFieldBoundsMeters = {
  xMinM: number | null
  xMaxM: number | null
  yMinM: number | null
  yMaxM: number | null
}

/** 非 D/U 軌道、設施、圍籬等：不參與導通／定位的占位 refField */
export const ZERO_REF_FIELD_BOUNDS_PARAMETERS: Record<string, number> = {
  [REF_FIELD_X_MIN_M]: 0,
  [REF_FIELD_X_MAX_M]: 0,
  [REF_FIELD_Y_MIN_M]: 0,
  [REF_FIELD_Y_MAX_M]: 0,
}

export function defaultRefFieldBoundsParameters(): Record<string, null> {
  return {
    [REF_FIELD_X_MIN_M]: null,
    [REF_FIELD_X_MAX_M]: null,
    [REF_FIELD_Y_MIN_M]: null,
    [REF_FIELD_Y_MAX_M]: null,
  }
}

/** 縱向、橫向跨度皆為 0（刻意排除導通掃描） */
export function isZeroRefFieldBoundsSpan(
  parameters: Record<string, unknown> | undefined,
): boolean {
  const bounds = getRefFieldBounds(parameters)
  const { xMinM, xMaxM, yMinM, yMaxM } = bounds
  if (
    xMinM === null ||
    xMaxM === null ||
    yMinM === null ||
    yMaxM === null ||
    !Number.isFinite(xMinM) ||
    !Number.isFinite(xMaxM) ||
    !Number.isFinite(yMinM) ||
    !Number.isFinite(yMaxM)
  ) {
    return false
  }
  return xMaxM - xMinM === 0 && yMaxM - yMinM === 0
}

function readOptionalNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function getRefFieldBounds(
  parameters: Record<string, unknown> | undefined,
): RefFieldBoundsMeters {
  const p = parameters ?? {}
  return {
    xMinM: readOptionalNum(p[REF_FIELD_X_MIN_M]),
    xMaxM: readOptionalNum(p[REF_FIELD_X_MAX_M]),
    yMinM: readOptionalNum(p[REF_FIELD_Y_MIN_M]),
    yMaxM: readOptionalNum(p[REF_FIELD_Y_MAX_M]),
  }
}

export function patchRefFieldBounds(
  parameters: Record<string, unknown> | undefined,
  patch: Partial<Record<keyof RefFieldBoundsMeters, number | null>>,
): Record<string, unknown> {
  const base = { ...(parameters ?? {}) }
  if (patch.xMinM !== undefined) base[REF_FIELD_X_MIN_M] = patch.xMinM
  if (patch.xMaxM !== undefined) base[REF_FIELD_X_MAX_M] = patch.xMaxM
  if (patch.yMinM !== undefined) base[REF_FIELD_Y_MIN_M] = patch.yMinM
  if (patch.yMaxM !== undefined) base[REF_FIELD_Y_MAX_M] = patch.yMaxM
  return base
}

/** 場域範圍所代表的實際場域寬高（公尺）；無有效區間時為 null */
export function refFieldBoundsSpanMeters(
  bounds: RefFieldBoundsMeters,
): { w: number; h: number } | null {
  const { xMinM, xMaxM, yMinM, yMaxM } = bounds
  if (xMinM === null || xMaxM === null || yMinM === null || yMaxM === null) {
    return null
  }
  const w = xMaxM - xMinM
  const h = yMaxM - yMinM
  if (!(w > 0) || !(h > 0)) return null
  return { w, h }
}

export function hasValidRefFieldBounds(
  parameters: Record<string, unknown> | undefined,
): boolean {
  return refFieldBoundsSpanMeters(getRefFieldBounds(parameters)) !== null
}

/** 無效時回傳可讀原因（供屬性面板／清單提示） */
export function describeRefFieldBoundsIssue(
  parameters: Record<string, unknown> | undefined,
): string | null {
  if (hasValidRefFieldBounds(parameters)) return null
  if (isZeroRefFieldBoundsSpan(parameters)) return null
  const { xMinM, xMaxM, yMinM, yMaxM } = getRefFieldBounds(parameters)
  if ([xMinM, xMaxM, yMinM, yMaxM].some((v) => v === null)) {
    return '請填寫橫向／縱向的最小值與最大值，共四個數字。'
  }
  if (xMaxM! <= xMinM!) {
    return `橫向最小值 (${xMinM}) 必須小於最大值 (${xMaxM})；若填反了請對調。`
  }
  if (yMaxM! <= yMinM!) {
    return `縱向最小值 (${yMinM}) 必須小於最大值 (${yMaxM})；若填反了請對調。`
  }
  return '尚未設定有效場域範圍。'
}

/** 最小／最大值填反時自動對調（僅在四邊皆有數字且可修正時） */
export function normalizeRefFieldBoundsParameters(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const b = getRefFieldBounds(parameters)
  if ([b.xMinM, b.xMaxM, b.yMinM, b.yMaxM].some((v) => v === null)) return null
  let { xMinM, xMaxM, yMinM, yMaxM } = b as {
    xMinM: number
    xMaxM: number
    yMinM: number
    yMaxM: number
  }
  let changed = false
  if (xMinM > xMaxM) {
    ;[xMinM, xMaxM] = [xMaxM, xMinM]
    changed = true
  }
  if (yMinM > yMaxM) {
    ;[yMinM, yMaxM] = [yMaxM, yMinM]
    changed = true
  }
  if (!changed) return null
  return patchRefFieldBounds(parameters, { xMinM, xMaxM, yMinM, yMaxM })
}

/** 四邊皆為有效數字時回傳範圍，否則 null */
export function getValidRefFieldBounds(
  parameters: Record<string, unknown> | undefined,
): {
  xMinM: number
  xMaxM: number
  yMinM: number
  yMaxM: number
} | null {
  const bounds = getRefFieldBounds(parameters)
  const span = refFieldBoundsSpanMeters(bounds)
  if (!span) return null
  return {
    xMinM: bounds.xMinM!,
    xMaxM: bounds.xMaxM!,
    yMinM: bounds.yMinM!,
    yMaxM: bounds.yMaxM!,
  }
}

/** 將場域範圍均分為 capacity 格，回傳第 subIndex 格中心（0-based） */
export function refFieldSubslotCenterMeters(
  bounds: { xMinM: number; xMaxM: number; yMinM: number; yMaxM: number },
  subIndex: number,
  capacity: number,
  options?: { splitAxis?: 'auto' | 'x' | 'y' },
): { xM: number; yM: number } {
  if (capacity <= 1) {
    return {
      xM: (bounds.xMinM + bounds.xMaxM) / 2,
      yM: (bounds.yMinM + bounds.yMaxM) / 2,
    }
  }
  const w = bounds.xMaxM - bounds.xMinM
  const h = bounds.yMaxM - bounds.yMinM
  const splitAxis = options?.splitAxis ?? 'auto'
  const splitAlongX =
    splitAxis === 'x' || (splitAxis === 'auto' && w >= h)
  if (splitAlongX) {
    const slice = w / capacity
    return {
      xM: bounds.xMinM + slice * (subIndex + 0.5),
      yM: (bounds.yMinM + bounds.yMaxM) / 2,
    }
  }
  const slice = h / capacity
  return {
    xM: (bounds.xMinM + bounds.xMaxM) / 2,
    yM: bounds.yMinM + slice * (subIndex + 0.5),
  }
}
