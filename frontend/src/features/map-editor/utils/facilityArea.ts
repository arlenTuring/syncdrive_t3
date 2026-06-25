import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import type {
  FacilityObject,
  FacilityFacility,
} from '../types/facility'
import { ruleMatched } from './mqttRuleMatch'

export type FacilityColorRule = {
  fieldPath: string
  operator: 'eq' | 'gt' | 'lt'
  compareValue: string
  color: string
}

export type FacilityAreaParameters = {
  /** 使用者填寫的設施用途（如充電格、洗車格）；平台不推斷 */
  purpose?: string
  remarks?: string
  defaultFillColor?: string
  colorRules?: FacilityColorRule[]
  iconDisplay?: 'none' | 'builtin' | 'custom'
  customIconUrl?: string
}

export function isFacilityFacility(f: FacilityObject): f is FacilityFacility {
  return f.type === 'Facility'
}

export function getFacilityParameters(
  f: FacilityObject,
): FacilityAreaParameters {
  if (f.type !== 'Facility' || !f.parameters) return {}
  return f.parameters as FacilityAreaParameters
}

export function parseFacilityColorRules(raw: unknown): FacilityColorRule[] {
  if (!Array.isArray(raw)) return []
  const out: FacilityColorRule[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const fieldPath = typeof o.fieldPath === 'string' ? o.fieldPath : ''
    const operatorRaw = o.operator
    const operator =
      operatorRaw === 'gt' || operatorRaw === 'lt' || operatorRaw === 'eq'
        ? operatorRaw
        : 'eq'
    const compareValue = typeof o.compareValue === 'string' ? o.compareValue : ''
    const color = typeof o.color === 'string' && o.color.trim() ? o.color : '#22c55e'
    out.push({ fieldPath, operator, compareValue, color })
  }
  return out
}

export function getComponentPurpose(f: FacilityObject): string {
  const raw = f.parameters?.purpose
  return typeof raw === 'string' ? raw.trim() : ''
}

/** @deprecated 使用 getComponentPurpose */
export function getFacilityPurpose(f: FacilityObject): string {
  return getComponentPurpose(f)
}

export function getFacilityRemarks(f: FacilityObject): string {
  const remarks = getFacilityParameters(f).remarks
  return typeof remarks === 'string' ? remarks.trim() : ''
}

function readPayloadPath(
  payload: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!payload || !path.trim()) return undefined
  const segs = path
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur: unknown = payload
  for (const seg of segs) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function resolveFacilityLiveValue(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): string {
  const rules = parseFacilityColorRules(getFacilityParameters(f).colorRules)
  for (const rule of rules) {
    if (!rule.fieldPath.trim()) continue
    const v = readPayloadPath(mqttLive?.payloadObject, rule.fieldPath)
    if (typeof v === 'string' || typeof v === 'number') return String(v)
  }
  return ''
}

export function resolveFacilityFillColor(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): string {
  const params = getFacilityParameters(f)
  const rules = parseFacilityColorRules(params.colorRules)
  for (const rule of rules) {
    if (!rule.fieldPath.trim() || !rule.compareValue.trim()) continue
    const raw = readPayloadPath(mqttLive?.payloadObject, rule.fieldPath)
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    if (ruleMatched(rule.operator, String(raw), rule.compareValue)) {
      return rule.color
    }
  }
  if (typeof mqttLive?.fillColor === 'string' && mqttLive.fillColor.trim()) {
    return mqttLive.fillColor.trim()
  }
  if (
    typeof params.defaultFillColor === 'string' &&
    params.defaultFillColor.trim()
  ) {
    return params.defaultFillColor.trim()
  }
  return '#334155'
}

export type FacilityDisplayInfo = {
  remarks: string
  liveValue: string
  fillColor: string
  colorRules: FacilityColorRule[]
}

export function resolveFacilityDisplay(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): FacilityDisplayInfo {
  const params = getFacilityParameters(f)
  return {
    remarks: getFacilityRemarks(f),
    liveValue: resolveFacilityLiveValue(f, mqttLive),
    fillColor: resolveFacilityFillColor(f, mqttLive),
    colorRules: parseFacilityColorRules(params.colorRules),
  }
}
