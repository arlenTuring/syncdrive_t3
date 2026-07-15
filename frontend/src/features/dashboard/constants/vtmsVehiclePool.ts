/** 示範車隊 PMS-01～PMS-11（與模擬器 VEHICLE_POOL 一致） */
export const VTMS_VEHICLE_POOL = Array.from({ length: 11 }, (_, i) =>
  `PMS-${String(i + 1).padStart(2, '0')}`,
);

export const SHIFT_TRIP_CODE_PATTERN = /^[DU]\d{4}$/i;

/** 與 demoSql MAINLINE_SHIFTS 一致：D1133 → 11:33 發、+6 分結束 */
export function tripStartMinutesFromCode(tripCode: string): number | null {
  const m = SHIFT_TRIP_CODE_PATTERN.exec(tripCode.trim());
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
