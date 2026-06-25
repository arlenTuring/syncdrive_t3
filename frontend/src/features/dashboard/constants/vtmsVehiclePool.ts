/** 示範車隊 PMS-01～PMS-11（與模擬器 VEHICLE_POOL 一致） */
export const VTMS_VEHICLE_POOL = Array.from({ length: 11 }, (_, i) =>
  `PMS-${String(i + 1).padStart(2, '0')}`,
);

export const SHIFT_TRIP_CODE_PATTERN = /^[DU]\d{4}$/i;
