import type { FacilityObject } from '../types/facility'
import { getMqttEntityId, getMqttTopicForFacility } from '../live/mqttEntityId'
import { parseFacilityColorRules } from './facilityArea'
import { parseTrackColorRules } from './trackFacility'
import { parseSignalIconRules } from './signalFacility'

/** 模擬改色輪播色票（不寫入地圖檔） */
export const MQTT_COLOR_SIM_PALETTE = [
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#3b82f6',
  '#a855f7',
  '#06b6d4',
] as const

export type MqttColorSimTarget = {
  facility: FacilityObject
  entityId: string
  topic: string
  label: string
}

/** 從目前地圖挑選可改色的元件（最多 max 個） */
export function pickMqttColorSimTargets(
  facilities: FacilityObject[],
  max = 6,
): MqttColorSimTarget[] {
  const candidates = facilities.filter(
    (f) =>
      f.type === 'Track' || f.type === 'Facility' || f.type === 'Signal',
  )
  const picked: MqttColorSimTarget[] = []
  const seen = new Set<string>()

  for (const f of candidates) {
    if (picked.length >= max) break
    const entityId = getMqttEntityId(f)
    if (seen.has(entityId)) continue
    seen.add(entityId)
    picked.push({
      facility: f,
      entityId,
      topic: getMqttTopicForFacility(f),
      label: f.customName.trim() || `${f.name} · ${f.id}`,
    })
  }

  return picked
}

function firstRuleFieldPayload(
  facility: FacilityObject,
  colorIndex: number,
): Record<string, unknown> | null {
  let rules: Array<{ fieldPath: string; compareValue: string }> = []
  if (facility.type === 'Track') {
    rules = parseTrackColorRules(facility.parameters?.colorRules)
  } else if (facility.type === 'Facility') {
    rules = parseFacilityColorRules(facility.parameters?.colorRules)
  } else if (facility.type === 'Signal') {
    rules = parseSignalIconRules(facility.parameters?.iconRules).map((r) => ({
      fieldPath: r.fieldPath,
      compareValue: r.compareValue,
    }))
  }
  if (rules.length === 0) return null
  const rule = rules[colorIndex % rules.length]
  if (!rule?.fieldPath.trim()) return null
  return { [rule.fieldPath]: rule.compareValue }
}

/** 依元件類型組出 MQTT payload（優先對應 colorRules，否則直接 fillColor／lamp） */
export function buildMqttColorSimPayload(
  facility: FacilityObject,
  entityId: string,
  colorIndex: number,
): Record<string, unknown> {
  const base = { entityId }
  const rulePayload = firstRuleFieldPayload(facility, colorIndex)
  if (rulePayload) {
    return { ...base, ...rulePayload }
  }

  const color = MQTT_COLOR_SIM_PALETTE[colorIndex % MQTT_COLOR_SIM_PALETTE.length]!

  if (facility.type === 'Signal') {
    const lamps = ['green', 'red', 'offline'] as const
    return { ...base, lamp: lamps[colorIndex % lamps.length] }
  }

  return { ...base, fillColor: color }
}
