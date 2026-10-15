/**
 * 回放畫面的時間顯示：一律標明時區（預設 Asia/Taipei），不依瀏覽器所在時區。
 */
export const REPLAY_TIME_ZONE = "Asia/Taipei";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string, withDate: boolean, withMs: boolean) {
  const key = `${timeZone}|${withDate}|${withMs}`;
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      ...(withDate ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...(withMs ? { fractionalSecondDigits: 3 } : {}),
    });
    formatters.set(key, value);
  }
  return value;
}

function parts(epoch: number, timeZone: string, withDate: boolean, withMs: boolean) {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone, withDate, withMs).formatToParts(new Date(epoch))) out[part.type] = part.value;
  return out;
}

/** 2026-10-15 08:00:00 */
export function formatDateTime(epoch: number, timeZone = REPLAY_TIME_ZONE): string {
  const p = parts(epoch, timeZone, true, false);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 08:00:00.123 */
export function formatClockMs(epoch: number, timeZone = REPLAY_TIME_ZONE): string {
  const p = parts(epoch, timeZone, false, true);
  return `${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}`;
}

/** 08:00:00 */
export function formatClock(epoch: number, timeZone = REPLAY_TIME_ZONE): string {
  const p = parts(epoch, timeZone, false, false);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 該時區相對 UTC 的位移（分鐘），用於把表單的「當地日期時間」換成帶時區的 ISO 字串 */
function offsetMinutes(epoch: number, timeZone: string): number {
  const p = parts(epoch, timeZone, true, false);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(epoch / 1000) * 1000) / 60_000);
}

/**
 * 表單值（YYYY-MM-DDTHH:mm[:ss]，視為指定時區的當地時間）→ 帶時區位移的 ISO 字串。
 * 格式不對回 null。
 */
export function zonedInputToIso(value: string, timeZone = REPLAY_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = "00"] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!Number.isFinite(naive)) return null;
  // 先用當下的位移估，再以估出的時刻校正一次（跨日光節約時間時才會不同）
  let offset = offsetMinutes(naive, timeZone);
  offset = offsetMinutes(naive - offset * 60_000, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

/** epoch → 表單值（指定時區的當地時間，到秒） */
export function epochToZonedInput(epoch: number, timeZone = REPLAY_TIME_ZONE): string {
  const p = parts(epoch, timeZone, true, false);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** 經過時間：1 小時 2 分 3 秒 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} 小時 ${m} 分`;
  if (m) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}
