/** 場域車輛代號 PMS-001 … PMS-011 */
export const VEHICLE_IDS = Array.from({ length: 11 }, (_, i) => {
  const n = i + 1
  return `PMS-${String(n).padStart(3, '0')}`
}) as readonly string[]

export type VehicleId = (typeof VEHICLE_IDS)[number]
