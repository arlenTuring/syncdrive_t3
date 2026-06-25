import type { FacilityObject } from '../types/facility'
import { buildMqttTopic, resolveMqttInstanceSegment } from './mqttCategories'

/**
 * 與 MQTT payload 的 entityId 對應。
 * 優先：舊版單一 mqttEntityId 字串
 * 否則：`{元件名稱}/{尾端ID}`（名稱為 palette 的 name，ID 在路徑最尾端）
 */
export function getMqttEntityId(f: FacilityObject): string {
  const legacy = f.parameters?.mqttEntityId
  if (typeof legacy === 'string' && legacy.trim().length > 0) {
    return legacy.trim()
  }
  const name = f.name
  const tail = resolveMqttInstanceSegment(f)
  return `${name}/${tail}`
}

export function getMqttTopicForFacility(f: FacilityObject): string {
  return buildMqttTopic(getMqttEntityId(f))
}
