/**
 * 營運日與營運時間
 * ==============
 *
 * 三種時間分開保存，不能混用：
 *
 * <table>
 *   <tr><td>計畫時間</td><td>班表上的時刻（當日分鐘，跨午夜的卡 ≥ 1440）。</td></tr>
 *   <tr><td>營運時間</td><td>這一次執行時，營運日上的時刻（Epoch 毫秒）。正式營運就是實際時間；
 *       加速重播時由營運時鐘照倍速推進（見 operating-clock.ts）。班次狀態、延誤、ETA、倒數都用它。</td></tr>
 *   <tr><td>實際時間</td><td>訊息送出／收到的時刻（created_at、vehicle_progress_at）。認證、逾時、
 *       訊息新鮮度這類技術判斷用它，不跟著倍速走。</td></tr>
 * </table>
 *
 * 營運日：班表展開到哪一天（{@link localMidnight} 的那一天）。次日凌晨的班次仍屬原營運日，
 * 歸屬寫在訂單 payload.operating_day，不用訂單建立日期或發車日期去切。
 */

/** 允許延誤界線：與訂單 delay_minutes（整分鐘、不到一分鐘算準點）及 ETA 的 MINOR_DELAY 門檻一致 */
export const DELAY_TOLERANCE_MS = 60_000;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 當地零點（與調度引擎把班表秒數落到絕對時刻的基準相同） */
export function localMidnight(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 時刻 → 營運日字串（YYYY-MM-DD，當地日期） */
export function operatingDayOf(at: number): string {
  const date = new Date(at);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isOperatingDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_PATTERN.test(value);
}

/** 營運日字串 → 當地零點；格式不對回 null */
export function operatingDayStart(day: string): number | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

/**
 * 展開某營運日計畫時用的參考時刻。取當天中午：調度引擎以 reference 的當地零點為基準，
 * 中午離兩端都遠，不會因為邊界誤差落到隔壁那一天。
 */
export function operatingDayReference(day: string): number | null {
  const start = operatingDayStart(day);
  return start == null ? null : start + 12 * 60 * 60 * 1000;
}
