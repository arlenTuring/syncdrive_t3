/**
 * 各車輛專用軌跡檔（public/trajectories/vehicles/PMS-xxx.json），每台車幾何不同。
 * `updatedAt` 用於排序「最新」；示範為每車一筆。
 */
import { VEHICLE_IDS } from './vehicles'

export type VehicleTrajectoryEntry = {
  id: string
  path: string
  label: string
  /** ISO 8601，用於排序「最新」 */
  updatedAt: string
}

const CATALOG_BY_VEHICLE: Record<string, VehicleTrajectoryEntry[]> = {}

VEHICLE_IDS.forEach((vid, i) => {
  const day = String(1 + (i % 28)).padStart(2, '0')
  CATALOG_BY_VEHICLE[vid] = [
    {
      id: `vehicle-demo-${vid}`,
      path: `/trajectories/vehicles/${vid}.json`,
      label: `專用示範軌跡（${vid}）`,
      updatedAt: `2025-03-${day}T12:00:00.000Z`,
    },
  ]
})

export function getTrajectoryCatalogForVehicle(
  vehicleId: string,
): VehicleTrajectoryEntry[] {
  return CATALOG_BY_VEHICLE[vehicleId] ?? []
}

export function getLatestTrajectoryEntry(
  vehicleId: string,
): VehicleTrajectoryEntry | null {
  const list = getTrajectoryCatalogForVehicle(vehicleId)
  return list[0] ?? null
}
