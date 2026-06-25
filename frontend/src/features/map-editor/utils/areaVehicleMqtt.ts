import type { MapAreaDomain, MapAreaMqttFields } from '../types/area'
import { isMeterInDomain } from './areaCoords'

function readPayloadPath(
  payload: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!payload || !path.trim()) return undefined
  let cur: unknown = payload
  for (const seg of path.split('.').map((s) => s.trim()).filter(Boolean)) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

/** 從 MQTT payload 依 Area 設定讀取車輛場域座標（公尺） */
export function readVehicleMetersFromPayload(
  payload: Record<string, unknown> | undefined,
  mqtt?: MapAreaMqttFields,
): { x: number; y: number } | null {
  if (!payload || !mqtt) return null
  const x = asFiniteNumber(readPayloadPath(payload, mqtt.xField ?? 'x'))
  const y = asFiniteNumber(readPayloadPath(payload, mqtt.yField ?? 'y'))
  if (x !== null && y !== null) return { x, y }

  const lx = asFiniteNumber(readPayloadPath(payload, 'local_pose.position.x'))
  const ly = asFiniteNumber(readPayloadPath(payload, 'local_pose.position.y'))
  if (lx !== null && ly !== null) return { x: lx, y: ly }

  return null
}

/** 車輛座標是否落在 Area 管制域內 → 應在此 Area 顯示 */
export function isVehicleInAreaDomain(
  xM: number,
  yM: number,
  domain: MapAreaDomain,
): boolean {
  return isMeterInDomain(xM, yM, domain)
}

/** 依 MQTT payload 判斷車輛是否應出現在此 Area */
export function shouldShowVehicleInArea(
  payload: Record<string, unknown> | undefined,
  domain: MapAreaDomain,
  mqtt?: MapAreaMqttFields,
): boolean {
  const pos = readVehicleMetersFromPayload(payload, mqtt)
  if (!pos) return false
  return isVehicleInAreaDomain(pos.x, pos.y, domain)
}
