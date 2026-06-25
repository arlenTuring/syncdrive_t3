export const VEHICLE_NUDGE_STEP = 0.25;
export const VEHICLE_NUDGE_SHIFT_STEP = 5;

/** 方向鍵微調座標精度（0.25 px） */
export function roundVehicleNudgeCoord(n: number): number {
  return Math.round(n * 4) / 4;
}
