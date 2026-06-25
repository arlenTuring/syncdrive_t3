/** 與地圖設施清單分離的「自駕車軌跡」JSON（可獨立載入／日後拆服務） */
export const TRAJECTORY_FILE_SCHEMA_VERSION = 1

export type TrajectoryPointEntry = {
  /** 單調遞增的時間戳（建議 Unix 毫秒），用於排序與回放間隔 */
  tMs: number
  /** 場域公尺座標，須與編輯器 10cm 吸附對齊（與 SNAP_METERS 一致） */
  positionMeters: { x: number; y: number }
}

export type TrajectoryFileV1 = {
  trajectorySchemaVersion: typeof TRAJECTORY_FILE_SCHEMA_VERSION
  trajectoryId: string
  displayName: string
  /** 建議搭配的地圖 mapId（僅提示，載入時可檢查） */
  mapId?: string
  /** 車輛代號，例如 PMS-001 */
  vehicleId?: string
  description?: string
  points: TrajectoryPointEntry[]
}

export type ParsedTrajectory = {
  trajectoryId: string
  displayName: string
  mapId: string | null
  vehicleId: string | null
  /** 已依 tMs 排序 */
  points: TrajectoryPointEntry[]
}
