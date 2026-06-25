import { SNAP_METERS } from '../constants/map'
import {
  TRAJECTORY_FILE_SCHEMA_VERSION,
  type ParsedTrajectory,
  type TrajectoryFileV1,
} from '../types/trajectoryFile'

function isSnapAlignedMeters(x: number): boolean {
  const n = x / SNAP_METERS
  return Number.isFinite(n) && Math.abs(Math.round(n) - n) < 1e-6
}

export function isTrajectoryFileV1(v: unknown): v is TrajectoryFileV1 {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.trajectorySchemaVersion === TRAJECTORY_FILE_SCHEMA_VERSION &&
    typeof o.trajectoryId === 'string' &&
    typeof o.displayName === 'string' &&
    Array.isArray(o.points)
  )
}

export function parseTrajectoryFileJson(json: unknown): ParsedTrajectory {
  if (!isTrajectoryFileV1(json)) {
    throw new Error('不是有效的軌跡檔（trajectorySchemaVersion 1）')
  }
  const mapId =
    typeof json.mapId === 'string' && json.mapId.length > 0 ? json.mapId : null
  const vehicleId =
    typeof json.vehicleId === 'string' && json.vehicleId.length > 0
      ? json.vehicleId
      : null

  const raw = json.points
  const points = raw.map((p, i) => {
    if (!p || typeof p !== 'object') {
      throw new Error(`第 ${i + 1} 個軌跡點格式錯誤`)
    }
    const o = p as Record<string, unknown>
    if (typeof o.tMs !== 'number' || !Number.isFinite(o.tMs)) {
      throw new Error(`第 ${i + 1} 個軌跡點：tMs 須為數字`)
    }
    const pm = o.positionMeters
    if (!pm || typeof pm !== 'object') {
      throw new Error(`第 ${i + 1} 個軌跡點：缺少 positionMeters`)
    }
    const m = pm as Record<string, unknown>
    if (typeof m.x !== 'number' || typeof m.y !== 'number') {
      throw new Error(`第 ${i + 1} 個軌跡點：positionMeters.x / y 須為數字`)
    }
    if (!isSnapAlignedMeters(m.x) || !isSnapAlignedMeters(m.y)) {
      throw new Error(
        `第 ${i + 1} 個軌跡點：座標須對齊編輯器吸附（${SNAP_METERS}m 的整數倍）`,
      )
    }
    return {
      tMs: o.tMs,
      positionMeters: { x: m.x, y: m.y },
    }
  })

  points.sort((a, b) => a.tMs - b.tMs)

  return {
    trajectoryId: json.trajectoryId,
    displayName: json.displayName,
    mapId,
    vehicleId,
    points,
  }
}
