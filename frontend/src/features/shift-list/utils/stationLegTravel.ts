import type { MapAreaObject } from '../../map-editor/types/area'
import type { PointTopology } from '../../map-editor/types/pointTopology'
import { buildTopologyRouteTravelBreakdown } from '../../map-editor/utils/topologyRouteTravel'

/** 相鄰兩停靠站之間的行駛時間（由點位拓撲展開後快照） */
export type ShiftScheduleStationLegTravel = {
  fromStationId: string
  toStationId: string
  avgTravelTimeSeconds: number
  minTravelTimeSeconds: number
  distanceMeters?: number | null
}

export function areStationLegTravelsComplete(
  stationIds: string[],
  legs: ShiftScheduleStationLegTravel[] | null | undefined,
): boolean {
  const expected = Math.max(0, stationIds.length - 1)
  if (expected === 0) return true
  if (!legs || legs.length !== expected) return false
  for (let i = 0; i < expected; i += 1) {
    const leg = legs[i]!
    const from = stationIds[i]!
    const to = stationIds[i + 1]!
    if (leg.fromStationId !== from || leg.toStationId !== to) return false
    if (
      !Number.isFinite(leg.avgTravelTimeSeconds)
      || leg.avgTravelTimeSeconds < 0
      || !Number.isFinite(leg.minTravelTimeSeconds)
      || leg.minTravelTimeSeconds < 0
    ) {
      return false
    }
    if (leg.minTravelTimeSeconds > leg.avgTravelTimeSeconds) return false
  }
  return true
}

export function sumStationLegTravelSeconds(
  legs: ShiftScheduleStationLegTravel[] | null | undefined,
): { avgTravelTimeSeconds: number; minTravelTimeSeconds: number } | null {
  if (!legs || legs.length === 0) return null
  let avg = 0
  let min = 0
  for (const leg of legs) {
    if (
      !Number.isFinite(leg.avgTravelTimeSeconds)
      || leg.avgTravelTimeSeconds < 0
      || !Number.isFinite(leg.minTravelTimeSeconds)
      || leg.minTravelTimeSeconds < 0
    ) {
      return null
    }
    avg += leg.avgTravelTimeSeconds
    min += leg.minTravelTimeSeconds
  }
  return {
    avgTravelTimeSeconds: Math.round(avg),
    minTravelTimeSeconds: Math.round(min),
  }
}

/**
 * 依拓撲站間權重，將班次實際行駛秒數（duration − dwell）分配到各 leg。
 * 無完整 leg 時回傳均分（舊行為）。
 */
export function resolveLegTravelSecondsForBudget(args: {
  stationIds: string[]
  legs: ShiftScheduleStationLegTravel[] | null | undefined
  travelBudgetSeconds: number
}): number[] {
  const { stationIds, legs, travelBudgetSeconds } = args
  const legCount = Math.max(0, stationIds.length - 1)
  if (legCount === 0) return []

  const budget = Math.max(0, travelBudgetSeconds)
  if (
    areStationLegTravelsComplete(stationIds, legs)
    && legs
    && legs.length === legCount
  ) {
    const weights = legs.map((leg) => Math.max(0, leg.avgTravelTimeSeconds))
    const weightSum = weights.reduce((sum, value) => sum + value, 0)
    if (weightSum > 0) {
      const raw = weights.map((weight) => (budget * weight) / weightSum)
      // 修正浮點誤差：最後一段吃剩餘，確保加總＝budget
      const allocated: number[] = []
      let used = 0
      for (let i = 0; i < legCount; i += 1) {
        if (i === legCount - 1) {
          allocated.push(Math.max(0, budget - used))
        } else {
          const value = raw[i]!
          allocated.push(value)
          used += value
        }
      }
      return allocated
    }
  }

  const equal = budget / legCount
  return Array.from({ length: legCount }, () => equal)
}

/** 從地圖拓撲展開路線站間行駛時間；拓撲不完整時回傳空陣列 */
export function buildStationLegTravelsFromTopology(
  topology: PointTopology,
  areas: MapAreaObject[],
  stationIds: string[],
): {
  legs: ShiftScheduleStationLegTravel[]
  timesComplete: boolean
  avgTravelTimeSeconds: number | null
  minTravelTimeSeconds: number | null
  warnings: string[]
} {
  if (stationIds.length < 2) {
    return {
      legs: [],
      timesComplete: true,
      avgTravelTimeSeconds: null,
      minTravelTimeSeconds: null,
      warnings: [],
    }
  }

  const breakdown = buildTopologyRouteTravelBreakdown(topology, areas, stationIds)
  if (!breakdown.timesComplete) {
    return {
      legs: [],
      timesComplete: false,
      avgTravelTimeSeconds: null,
      minTravelTimeSeconds: null,
      warnings: breakdown.warnings,
    }
  }

  const legs: ShiftScheduleStationLegTravel[] = breakdown.legs.map((leg) => ({
    fromStationId: leg.fromStationId,
    toStationId: leg.toStationId,
    avgTravelTimeSeconds: leg.avgTravelTimeSeconds ?? 0,
    minTravelTimeSeconds: leg.minTravelTimeSeconds ?? 0,
    distanceMeters: leg.distanceMeters,
  }))

  return {
    legs,
    timesComplete: true,
    avgTravelTimeSeconds: breakdown.totalAvgTravelTimeSeconds,
    minTravelTimeSeconds: breakdown.totalMinTravelTimeSeconds,
    warnings: [],
  }
}

export function parseStationLegTravels(raw: unknown): ShiftScheduleStationLegTravel[] {
  if (!Array.isArray(raw)) return []
  const out: ShiftScheduleStationLegTravel[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const fromStationId = typeof o.fromStationId === 'string' ? o.fromStationId.trim() : ''
    const toStationId = typeof o.toStationId === 'string' ? o.toStationId.trim() : ''
    if (!fromStationId || !toStationId) continue
    const avg =
      typeof o.avgTravelTimeSeconds === 'number' && Number.isFinite(o.avgTravelTimeSeconds)
        ? Math.round(o.avgTravelTimeSeconds)
        : null
    const min =
      typeof o.minTravelTimeSeconds === 'number' && Number.isFinite(o.minTravelTimeSeconds)
        ? Math.round(o.minTravelTimeSeconds)
        : null
    if (avg == null || min == null || avg < 0 || min < 0) continue
    const distanceMeters =
      typeof o.distanceMeters === 'number' && Number.isFinite(o.distanceMeters)
        ? o.distanceMeters
        : null
    out.push({
      fromStationId,
      toStationId,
      avgTravelTimeSeconds: avg,
      minTravelTimeSeconds: min,
      distanceMeters,
    })
  }
  return out
}

export function describeStationLegTravelIssue(
  stationIds: string[],
  legs: ShiftScheduleStationLegTravel[] | null | undefined,
): { code: 'incomplete' | 'invalid'; message: string } | null {
  const expected = Math.max(0, stationIds.length - 1)
  if (expected === 0) return null
  if (!legs || legs.length === 0) {
    return {
      code: 'incomplete',
      message: '路線缺少點位拓撲站間行駛時間，站點時刻將依總行駛秒數均分估算',
    }
  }
  if (legs.length !== expected) {
    return {
      code: 'incomplete',
      message: `站間行駛時間段數不符（需 ${expected} 段，實際 ${legs.length} 段）`,
    }
  }
  for (let i = 0; i < expected; i += 1) {
    const leg = legs[i]!
    const from = stationIds[i]!
    const to = stationIds[i + 1]!
    if (leg.fromStationId !== from || leg.toStationId !== to) {
      return {
        code: 'incomplete',
        message: `站間行駛時間與站序不符（第 ${i + 1} 段）`,
      }
    }
    if (leg.minTravelTimeSeconds < 0 || leg.avgTravelTimeSeconds < 0) {
      return {
        code: 'invalid',
        message: `站間行駛時間不可為負（${from} → ${to}）`,
      }
    }
    if (leg.minTravelTimeSeconds > leg.avgTravelTimeSeconds) {
      return {
        code: 'invalid',
        message: `站間最快時間大於平均時間（${from} → ${to}）`,
      }
    }
  }
  return null
}

/**
 * 引擎佔用／循環用的有效行駛秒數。
 * 拓撲站間完整時以 Σ(leg) 為準；否則回退整線 avg/min。
 */
export function resolveEffectiveRouteTravelSeconds(route: {
  stationIds: string[]
  stationLegTravels?: ShiftScheduleStationLegTravel[] | null
  avgTravelTimeSeconds?: number | null
  minTravelTimeSeconds?: number | null
}): { avgTravelTimeSeconds: number; minTravelTimeSeconds: number } | null {
  if (areStationLegTravelsComplete(route.stationIds, route.stationLegTravels)) {
    const summed = sumStationLegTravelSeconds(route.stationLegTravels)
    if (summed && summed.avgTravelTimeSeconds > 0) {
      return {
        avgTravelTimeSeconds: summed.avgTravelTimeSeconds,
        minTravelTimeSeconds: Math.max(0, summed.minTravelTimeSeconds),
      }
    }
  }
  const avg = route.avgTravelTimeSeconds
  if (avg == null || !Number.isFinite(avg) || avg <= 0) return null
  const min = route.minTravelTimeSeconds
  if (min != null && Number.isFinite(min) && min > avg) return null
  return {
    avgTravelTimeSeconds: avg,
    minTravelTimeSeconds: min != null && Number.isFinite(min) && min > 0 ? min : avg,
  }
}
