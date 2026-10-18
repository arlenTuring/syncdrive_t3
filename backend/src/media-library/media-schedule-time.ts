import { BadRequestException } from '@nestjs/common';

/**
 * 媒體排程的時間計算（純函式）。所有「本地時間」都依排程保存的時區解讀，跟主機與瀏覽器的時區無關。
 *
 * 夏令時間：
 * - 不存在的本地時點（往前跳的那一小時）：順延到跳過之後的同一分鐘差（例如 02:30 → 03:30），只播一次。
 * - 重複的本地時點（往回撥的那一小時）：只取第一次出現（較早的那個絕對時刻），不播兩次。
 * 台北沒有夏令時間，這兩條規則只對其他時區生效。
 */

export type Weekly = Record<string, string[]>; // '1'（週一）…'7'（週日）→ ['08:00', ...]
export const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export function assertTimeZone(raw: unknown): string {
  const tz = typeof raw === 'string' ? raw.trim() : '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException('時區無效');
  }
  if (!tz) throw new BadRequestException('時區無效');
  return tz;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(epoch: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(epoch))) out[p.type] = p.value;
  return out;
}

/** 這個絕對時刻在該時區的本地日期、時間、星期（1=週一…7=週日） */
export function zonedParts(epoch: number, tz: string) {
  const p = parts(epoch, tz);
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as 'Mon'] ?? 1;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, second: Number(p.second), weekday };
}

function offsetMs(epoch: number, tz: string) {
  const p = parts(epoch, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/**
 * 本地日期＋時間（該時區）→ 絕對時刻。重複時點取較早者；不存在時點順延。
 */
export function zonedToEpoch(date: string, time: string, tz: string): number {
  const d = DATE_RE.exec(date), t = TIME_RE.exec(time);
  if (!d || !t) throw new BadRequestException('日期或時間格式不正確');
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // 用前後各 1 天的位移試算，取「換回本地剛好等於目標」中最早的
  const candidates = [...new Set([offsetMs(naive - DAY_MS, tz), offsetMs(naive, tz), offsetMs(naive + DAY_MS, tz)])]
    .map((offset) => naive - offset)
    .filter((epoch) => {
      const z = zonedParts(epoch, tz);
      return z.date === date && z.time === time;
    })
    .sort((a, b) => a - b);
  if (candidates.length) return candidates[0];
  // 不存在（跳過的那段）：以跳過前的位移換算，落在跳過之後
  return naive - offsetMs(naive - DAY_MS, tz);
}

export function addDays(date: string, days: number) {
  const d = DATE_RE.exec(date)!;
  const v = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) + days * DAY_MS);
  return v.toISOString().slice(0, 10);
}

function weekdayOf(date: string) {
  const d = DATE_RE.exec(date)!;
  const day = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay();
  return day === 0 ? 7 : day;
}

export function assertDate(raw: unknown, label: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const d = DATE_RE.exec(value);
  if (!d) throw new BadRequestException(`${label}格式不正確`);
  const check = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  if (check.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label}不是有效日期`);
  return value;
}

/** 星期時點：至少一天、每天至少一個 HH:mm、同一天不重複；回傳依時間升序整理後的結果 */
export function normaliseWeekly(raw: unknown): Weekly {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('請設定播放的星期與時間');
  const out: Weekly = {};
  for (const [day, times] of Object.entries(raw as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) throw new BadRequestException('星期設定不正確');
    if (!Array.isArray(times) || times.length === 0) throw new BadRequestException(`${weekdayLabel(day)}至少要有一個時間`);
    const seen = new Set<string>();
    for (const time of times) {
      if (typeof time !== 'string' || !TIME_RE.test(time)) throw new BadRequestException(`${weekdayLabel(day)}的時間格式不正確`);
      if (seen.has(time)) throw new BadRequestException(`${weekdayLabel(day)}的 ${time} 重複`);
      seen.add(time);
    }
    if (seen.size > 48) throw new BadRequestException(`${weekdayLabel(day)}最多 48 個時間`);
    out[day] = [...seen].sort();
  }
  if (!Object.keys(out).length) throw new BadRequestException('請至少選擇一個星期並設定時間');
  return out;
}

export function weekdayLabel(day: string) {
  return `週${'一二三四五六日'[Number(day) - 1] ?? '?'}`;
}

export function parseLocalDateTime(raw: unknown): { date: string; time: string } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00)?$/.exec(value);
  if (!m) throw new BadRequestException('開始時間格式不正確');
  assertDate(m[1], '開始日期');
  if (!TIME_RE.test(m[2])) throw new BadRequestException('開始時間格式不正確');
  return { date: m[1], time: m[2] };
}

/**
 * 定時播放：嚴格晚於 after 的下一個時點（含首尾日期）；沒有就回 null。
 * 只往後看，不預先展開所有未來時點；最多掃 400 天（每天都會被選到的情況下一定找得到）。
 */
export function nextTimedOccurrence(input: { startDate: string; endDate: string | null; weekly: Weekly; timeZone: string }, after: number): number | null {
  const fromLocal = zonedParts(after, input.timeZone).date;
  let date = fromLocal < input.startDate ? input.startDate : addDays(fromLocal, -1);
  for (let i = 0; i < 400; i += 1, date = addDays(date, 1)) {
    if (input.endDate && date > input.endDate) return null;
    if (date < input.startDate) continue;
    const times = input.weekly[String(weekdayOf(date))];
    if (!times?.length) continue;
    const epochs = [...new Set(times.map((time) => zonedToEpoch(date, time, input.timeZone)))].sort((a, b) => a - b);
    const hit = epochs.find((epoch) => epoch > after);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** 從 from（含）到 to（含）之間有幾個時點（錯過時點計數用，有上限） */
export function countTimedOccurrences(input: Parameters<typeof nextTimedOccurrence>[0], from: number, to: number, cap = 1000) {
  let count = 0;
  let cursor = from - 1;
  while (count < cap) {
    const next = nextTimedOccurrence(input, cursor);
    if (next === null || next > to) break;
    count += 1;
    cursor = next;
  }
  return count;
}
