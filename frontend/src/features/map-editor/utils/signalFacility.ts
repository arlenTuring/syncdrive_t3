import type { MqttLiveEntry } from '../live/mqttLiveTypes'
import type { FacilityObject } from '../types/facility'
import type { LabelPlacement } from './facilityLabelStyle'
import { readPayloadPath, ruleMatched, type RuleOperator } from './mqttRuleMatch'

export const SIGNAL_MOUNT_DIRECTIONS = ['up', 'down', 'left', 'right'] as const
export type SignalMountDirection = (typeof SIGNAL_MOUNT_DIRECTIONS)[number]

export const SIGNAL_LAMPS = ['green', 'red', 'offline'] as const
export type SignalLamp = (typeof SIGNAL_LAMPS)[number]

export const TRAFFIC_SIGNAL_ICONS_BASE = '/map-editor-icons/traffic-signals'

export type SignalIconRule = {
  fieldPath: string
  operator: RuleOperator
  compareValue: string
  lamp: SignalLamp
}

export type SignalFacilityParameters = {
  mountDirection?: SignalMountDirection
  defaultLamp?: SignalLamp
  iconRules?: SignalIconRule[]
}

export type SignalDisplayInfo = {
  mountDirection: SignalMountDirection
  lamp: SignalLamp
  iconUrl: string
}

function getSignalParameters(f: FacilityObject): SignalFacilityParameters {
  if (f.type !== 'Signal' || !f.parameters) return {}
  return f.parameters as SignalFacilityParameters
}

export function parseSignalMountDirection(raw: unknown): SignalMountDirection {
  if (
    raw === 'up' ||
    raw === 'down' ||
    raw === 'left' ||
    raw === 'right'
  ) {
    return raw
  }
  return 'down'
}

export function parseSignalLamp(raw: unknown): SignalLamp | null {
  if (raw === 'green' || raw === 'red' || raw === 'offline') return raw
  return null
}

export function signalIconUrl(
  lamp: SignalLamp,
  mount: SignalMountDirection,
): string {
  return `${TRAFFIC_SIGNAL_ICONS_BASE}/${lamp}_${mount}.png`
}

export function parseSignalIconRules(raw: unknown): SignalIconRule[] {
  if (!Array.isArray(raw)) return []
  const out: SignalIconRule[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const fieldPath = typeof o.fieldPath === 'string' ? o.fieldPath : ''
    const operatorRaw = o.operator
    const operator: RuleOperator =
      operatorRaw === 'gt' || operatorRaw === 'lt' || operatorRaw === 'eq'
        ? operatorRaw
        : 'eq'
    const compareValue =
      typeof o.compareValue === 'string' ? o.compareValue : ''
    const lamp = parseSignalLamp(o.lamp) ?? 'green'
    out.push({ fieldPath, operator, compareValue, lamp })
  }
  return out
}

export function resolveSignalLamp(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): SignalLamp {
  const p = getSignalParameters(f)
  const rules = parseSignalIconRules(p.iconRules)
  for (const rule of rules) {
    if (!rule.fieldPath.trim() || !rule.compareValue.trim()) continue
    const raw = readPayloadPath(mqttLive?.payloadObject, rule.fieldPath)
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    if (ruleMatched(rule.operator, String(raw), rule.compareValue)) {
      return rule.lamp
    }
  }
  if (mqttLive?.signalLamp) {
    return mqttLive.signalLamp
  }
  const def = parseSignalLamp(p.defaultLamp)
  if (def) return def
  return 'offline'
}

/** 號誌未指定 labelPlacement 時，依安裝方向推斷名稱位置 */
export function labelPlacementFromSignalMount(
  mount: SignalMountDirection,
): LabelPlacement {
  switch (mount) {
    case 'up':
      return 'above'
    case 'down':
      return 'below'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

/** @deprecated 請改用 labelPlacementFlexClass */
export function signalLabelFlexClass(mount: SignalMountDirection): string {
  switch (mount) {
    case 'right':
      return 'flex-row-reverse items-center justify-center gap-1'
    case 'left':
      return 'flex-row items-center justify-center gap-1'
    case 'down':
      return 'flex-col-reverse items-center justify-center gap-0.5'
    case 'up':
      return 'flex-col items-center justify-center gap-0.5'
  }
}

export function resolveSignalDisplay(
  f: FacilityObject,
  mqttLive?: MqttLiveEntry,
): SignalDisplayInfo {
  const p = getSignalParameters(f)
  const mountDirection = parseSignalMountDirection(p.mountDirection)
  const lamp = resolveSignalLamp(f, mqttLive)
  return {
    mountDirection,
    lamp,
    iconUrl: signalIconUrl(lamp, mountDirection),
  }
}
