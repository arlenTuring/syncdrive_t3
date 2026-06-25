import type { PSDState } from '../types/facility'
import type { MqttLiveEntry } from '../live/mqttLiveTypes'

export const DEFAULT_PSD_OPEN_PERCENT_KEY = 'openPercent'

/** 地圖參數／UI 滑桿：數值即為 0–100 百分比（1 = 1%，非 100%） */
export function normalizeOpenPercentPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, raw))
}

/** MQTT／JSON：0–1 小數為比例；其餘視為 0–100 百分比 */
export function normalizeOpenPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  if (raw > 0 && raw < 1) return raw * 100
  if (raw === 0 || raw === 1) return raw * 100
  return Math.min(100, Math.max(0, raw))
}

/** 從 MQTT JSON 解析開度（支援多種欄位名與離散狀態） */
export function parseOpenPercentFromPayload(
  o: Record<string, unknown>,
  preferredKey?: string,
): number | undefined {
  const keys = [
    preferredKey,
    DEFAULT_PSD_OPEN_PERCENT_KEY,
    'open_percent',
    'doorOpenPercent',
    'door_open_percent',
    'positionPct',
    'position_pct',
  ].filter((k): k is string => typeof k === 'string' && k.length > 0)

  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      return normalizeOpenPercent(v)
    }
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return normalizeOpenPercent(n)
    }
  }

  const discrete = o.state ?? o.psdState ?? o.doorState ?? o.gateState
  if (typeof discrete === 'string') {
    return psdStateToOpenPercent(discrete as PSDState)
  }

  return undefined
}

export function psdStateToOpenPercent(state: PSDState | string): number {
  switch (state) {
    case 'Open':
      return 100
    case 'Moving':
      return 50
    case 'Closed':
    case 'Alarm':
    default:
      return 0
  }
}

export function openPercentToPsdState(pct: number, alarm: boolean): PSDState {
  if (alarm) return 'Alarm'
  if (pct >= 99.5) return 'Open'
  if (pct <= 0.5) return 'Closed'
  return 'Moving'
}

export function resolvePsdAlarm(
  o: Record<string, unknown>,
  fallbackState: PSDState,
): boolean {
  if (o.alarm === true || o.isAlarm === true || o.fault === true) return true
  const s = o.state ?? o.psdState ?? o.doorState
  if (s === 'Alarm' || s === 'ALARM') return true
  return fallbackState === 'Alarm'
}

export type PsdFacilityLike = {
  currentState: string
  parameters?: Record<string, unknown>
}

/** 合併地圖預設、MQTT 即時開度 */
export function resolvePsdDisplay(
  facility: PsdFacilityLike,
  mqttLive?: MqttLiveEntry,
): { openPercent: number; alarm: boolean } {
  let openPercent: number | undefined
  let alarm = facility.currentState === 'Alarm' || facility.currentState === 'ALARM'

  if (mqttLive?.psdOpenPercent !== undefined) {
    openPercent = normalizeOpenPercent(mqttLive.psdOpenPercent)
    if (mqttLive.psdAlarm !== undefined) alarm = mqttLive.psdAlarm
  }

  if (openPercent === undefined) {
    const param = facility.parameters?.openPercent
    if (typeof param === 'number' && Number.isFinite(param)) {
      openPercent = normalizeOpenPercentPercent(param)
    } else if (typeof param === 'string' && param.trim() !== '') {
      const n = Number(param)
      if (Number.isFinite(n)) openPercent = normalizeOpenPercentPercent(n)
    }
  }

  if (openPercent === undefined) {
    openPercent = psdStateToOpenPercent(facility.currentState as PSDState)
  }

  if (facility.parameters?.alarm === true) alarm = true

  return { openPercent, alarm }
}
