/** 示範車隊 PMS01～PMS11（與模擬器 VEHICLE_POOL 一致） */
export const VTMS_VEHICLE_POOL = Array.from({ length: 11 }, (_, i) =>
  `PMS${String(i + 1).padStart(2, '0')}`,
);

/**
 * 聯測／除錯車：不在車隊清單（班表、派車都不列），但地圖要能看到它——
 * 模擬器的「PMS99 單車除錯」讓它一台單獨上線，沿選定路線開。
 */
export const VTMS_DEBUG_VEHICLES = ['PMS99'] as const;

/**
 * 正線班次代號。
 *
 * 舊的是方向加時間（U0830、D1133），排班引擎現在發的是路線代號加時間：NT1510 是
 * N2W 開往 T3、TNB1507 是往備用月台的那一條。只認舊格式的話，MQTT 進來的即時班次
 * 一律被當成不是正線班次丟掉，卡片就只剩 SQL 那份、不會即時更新。
 */
export const SHIFT_TRIP_CODE_PATTERN = /^([DU]|[A-Z]{2,3})\d{4}$/i;

/** 舊格式（U0830／D1133）：代號本身就帶發車時間，才推得出時刻 */
export const LEGACY_SHIFT_TRIP_CODE_PATTERN = /^[DU]\d{4}$/i;

/** 與 demoSql MAINLINE_SHIFTS 一致：D1133 → 11:33 發、+6 分結束 */
export function tripStartMinutesFromCode(tripCode: string): number | null {
  const m = LEGACY_SHIFT_TRIP_CODE_PATTERN.exec(tripCode.trim());
  if (!m) return null;
  const hour = parseInt(tripCode.slice(1, 3), 10);
  const minute = parseInt(tripCode.slice(3, 5), 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutesAsHm(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function shiftTripScheduleFromCode(tripCode: string): { depart_time: string; end_time: string } | null {
  const start = tripStartMinutesFromCode(tripCode);
  if (start === null) return null;
  return {
    depart_time: formatMinutesAsHm(start),
    end_time: formatMinutesAsHm(start + 6),
  };
}
