/**
 * 規格書 3.2：每一個 <code>*_at</code>（13 位 Epoch 毫秒）都要有成對的
 * <code>*_clock</code>（當地 <code>HH:MM:SS</code>）。
 *
 * <strong>跨午夜一律用次日時刻</strong>，不寫成 <code>25:10:30</code>——日期由
 * <code>*_at</code> 判定。班表那邊的秒數是「當日第幾秒」、可以超過 86400，兩套表示
 * 法不同，轉換時必須經過絕對時刻，不能直接把班表秒數格式化出去。
 */

/** 當地時區的當日零點（毫秒）。班表秒數要落到絕對時刻時的基準。 */
export function localMidnightMs(reference: number): number {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 絕對時刻 → 當地 HH:MM:SS（24 小時制） */
export function toClock(atMs: number | null): string | null {
  if (atMs == null || !Number.isFinite(atMs)) return null;
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 班表的「當日第幾秒」→ 絕對時刻。
 *
 * 班表允許秒數超過 86400（跨午夜的班次），直接加上去就會落到次日，這正是要的結果。
 */
export function scheduleSecondToAt(
  daySecond: number | null | undefined,
  reference: number,
): number | null {
  if (daySecond == null || !Number.isFinite(daySecond)) return null;
  return localMidnightMs(reference) + Math.round(daySecond) * 1000;
}
