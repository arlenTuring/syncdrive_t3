import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import type { FacilityObject } from '../types/facility'

export type TrackColorRule = {
  fieldPath: string
  operator: 'eq' | 'gt' | 'lt'
  compareValue: string
  color: string
}

export type TrackFacilityParameters = {
  defaultFillColor?: string
  colorRules?: TrackColorRule[]
}

function getTrackParameters(f: FacilityObject): TrackFacilityParameters {
  if (f.type !== 'Track' || !f.parameters) return {}
  return f.parameters as TrackFacilityParameters
}

export function parseTrackColorRules(raw: unknown): TrackColorRule[] {
  if (!Array.isArray(raw)) return []
  const out: TrackColorRule[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const fieldPath = typeof o.fieldPath === 'string' ? o.fieldPath : ''
    const operatorRaw = o.operator
    const operator =
      operatorRaw === 'gt' || operatorRaw === 'lt' || operatorRaw === 'eq'
        ? operatorRaw
        : 'eq'
    const compareValue =
      typeof o.compareValue === 'string' ? o.compareValue : ''
    const color = typeof o.color === 'string' && o.color.trim() ? o.color : '#22c55e'
    out.push({ fieldPath, operator, compareValue, color })
  }
  return out
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

function ruleMatched(rule: TrackColorRule, live: string): boolean {
  if (rule.operator === 'eq') return live === rule.compareValue
  const liveNum = Number(live)
  const ruleNum = Number(rule.compareValue)
  if (!Number.isFinite(liveNum) || !Number.isFinite(ruleNum)) return false
  if (rule.operator === 'gt') return liveNum > ruleNum
  return liveNum < ruleNum
}

export function resolveTrackFillColor(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): string {
  if (f.type !== 'Track') return '#52525b'
  const p = getTrackParameters(f)
  const rules = parseTrackColorRules(p.colorRules)
  for (const rule of rules) {
    if (!rule.fieldPath.trim() || !rule.compareValue.trim()) continue
    const raw = readPayloadPath(mqttLive?.payloadObject, rule.fieldPath)
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    if (ruleMatched(rule, String(raw))) {
      return rule.color
    }
  }
  if (typeof mqttLive?.fillColor === 'string' && mqttLive.fillColor.trim()) {
    return mqttLive.fillColor.trim()
  }
  if (typeof p.defaultFillColor === 'string' && p.defaultFillColor.trim()) {
    return p.defaultFillColor.trim()
  }
  return '#52525b'
}

