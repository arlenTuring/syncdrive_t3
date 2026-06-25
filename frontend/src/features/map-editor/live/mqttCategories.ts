import type { FacilityObject } from '../types/facility'

/**
 * 尾段 ID：parameters.mqttInstanceId 可覆寫；未設定則用設施 id。
 * 舊版曾用「名稱+連字+id」單段，會正規化為純 id。
 */
export function resolveMqttInstanceSegment(f: FacilityObject): string {
  const raw = f.parameters?.mqttInstanceId
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const t = raw.trim()
    const oldCombined = `${f.name}-${f.id}`
    if (t === oldCombined) {
      return f.id
    }
    if (t === f.id) {
      return f.id
    }
    return t
  }
  return f.id
}

/** 完整 topic：syncdrive/{entityId}，entityId 為「元件名稱/尾端ID」 */
export function buildMqttTopic(entityId: string): string {
  return `syncdrive/${entityId}`
}
