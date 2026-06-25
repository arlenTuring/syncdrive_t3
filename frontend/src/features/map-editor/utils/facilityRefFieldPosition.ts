/** 元件 parameters 內「參照場域位置」（單點，公尺，場域座標系） */
export const REF_FIELD_X_M = 'refFieldXM'
export const REF_FIELD_Y_M = 'refFieldYM'

export type RefFieldPositionMeters = {
  xM: number | null
  yM: number | null
}

export function defaultRefFieldPositionParameters(): Record<string, null> {
  return {
    [REF_FIELD_X_M]: null,
    [REF_FIELD_Y_M]: null,
  }
}

function readOptionalNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function getRefFieldPosition(
  parameters: Record<string, unknown> | undefined,
): RefFieldPositionMeters {
  const p = parameters ?? {}
  return {
    xM: readOptionalNum(p[REF_FIELD_X_M]),
    yM: readOptionalNum(p[REF_FIELD_Y_M]),
  }
}

export function patchRefFieldPosition(
  parameters: Record<string, unknown> | undefined,
  patch: Partial<RefFieldPositionMeters>,
): Record<string, unknown> {
  const base = { ...(parameters ?? {}) }
  if (patch.xM !== undefined) base[REF_FIELD_X_M] = patch.xM
  if (patch.yM !== undefined) base[REF_FIELD_Y_M] = patch.yM
  return base
}

export function hasValidRefFieldPosition(
  parameters: Record<string, unknown> | undefined,
): boolean {
  const { xM, yM } = getRefFieldPosition(parameters)
  return xM !== null && yM !== null
}
