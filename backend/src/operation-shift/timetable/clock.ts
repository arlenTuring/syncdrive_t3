/** 與前端排班引擎相同：計畫時刻 10 秒格 */

export const CLOCK_ALIGN_SECONDS = 10;
export const STATION_ARRIVAL_MAX_AVG_STRETCH = 1.3;
export const DAY_END_SECOND = 24 * 3600;

export function snapUpToClockAlignSeconds(
  seconds: number,
  gridSeconds = CLOCK_ALIGN_SECONDS,
): number {
  if (gridSeconds <= 0) return Math.round(seconds);
  return Math.ceil(seconds / gridSeconds) * gridSeconds;
}

export function snapDownToClockAlignSeconds(
  seconds: number,
  gridSeconds = CLOCK_ALIGN_SECONDS,
): number {
  if (gridSeconds <= 0) return Math.round(seconds);
  return Math.floor(seconds / gridSeconds) * gridSeconds;
}

export function isClockAlignedSeconds(
  seconds: number,
  gridSeconds = CLOCK_ALIGN_SECONDS,
): boolean {
  if (gridSeconds <= 0) return true;
  return Math.round(seconds) % gridSeconds === 0;
}

export function minuteToSecond(minute: number): number {
  return minute * 60;
}

export function secondToMinute(second: number): number {
  return second / 60;
}

/** 自 00:00 起的秒數 → HH:MM:SS */
export function formatSecondToHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * 解析時間參數：
 * - HH:MM:SS / HH:MM
 * - 純秒數字串
 * - 分鐘小數（若含小數點且 < 1440 視為分鐘）
 */
export function parseClockToSecond(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return null;
    // 純整數秒；若看起來像「整天分鐘」(≤1440) 且帶小數 → 當分鐘
    if (text.includes('.') && n <= 1440) return Math.round(n * 60);
    return Math.round(n);
  }

  const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] != null ? Number(m[3]) : 0;
  if (
    !Number.isFinite(h)
    || !Number.isFinite(mi)
    || !Number.isFinite(se)
    || h < 0
    || mi < 0
    || mi > 59
    || se < 0
    || se > 59
  ) {
    return null;
  }
  return h * 3600 + mi * 60 + se;
}

/**
 * 班次代號用的開始時刻 HHMM。
 * 與前端一致：以時鐘分鐘地板為準（01:09:40 → 0109）。
 */
export function formatMinuteToHmCompact(startMinute: number): string {
  const total = Math.max(0, Math.floor(startMinute));
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}
