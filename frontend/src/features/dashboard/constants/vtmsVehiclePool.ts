/** 示範車隊 PMS01～PMS11（與模擬器 VEHICLE_POOL 一致） */
export const VTMS_VEHICLE_POOL = Array.from({ length: 11 }, (_, i) =>
  `PMS${String(i + 1).padStart(2, '0')}`,
);

/**
 * 聯測／除錯車：不在車隊清單（班表、派車都不列），但地圖要能看到它——
 * 模擬器的「PMS99 單車除錯」讓它一台單獨上線，沿選定路線開。
 */
export const VTMS_DEBUG_VEHICLES = ['PMS99'] as const;
