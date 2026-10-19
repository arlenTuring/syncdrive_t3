/**
 * 時間：後端一律 UTC epoch 毫秒；畫面以網站時區（系統設定，預設 Asia/Taipei）顯示與輸入，不看瀏覽器所在地。
 * 區間定義為起點含、終點不含：使用者選的結束時刻（到秒）會被包含，所以查詢終點是「結束時刻 + 1 秒」。
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(epoch: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(epoch))) out[p.type] = p.value;
  return out;
}

/** YYYY-MM-DD HH:mm:ss（網站時區） */
export function formatDateTime(epoch: number | null | undefined, tz: string) {
  if (epoch === null || epoch === undefined || !Number.isFinite(epoch)) return '—';
  const p = parts(epoch, tz);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** SiteDateTimeInput 的值格式 YYYY-MM-DDTHH:mm:ss */
export function toLocalInput(epoch: number, tz: string) {
  const p = parts(epoch, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function offsetMs(epoch: number, tz: string) {
  const p = parts(epoch, tz);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(epoch / 1000) * 1000;
}

/** 網站時區的本地時間 → epoch 毫秒；夏令時間重複時點取較早者、不存在時點順延 */
export function localInputToEpoch(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const candidates = [...new Set([offsetMs(naive - 86_400_000, tz), offsetMs(naive, tz), offsetMs(naive + 86_400_000, tz)])]
    .map((o) => naive - o)
    .filter((epoch) => toLocalInput(epoch, tz) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`)
    .sort((a, b) => a - b);
  return candidates[0] ?? naive - offsetMs(naive - 86_400_000, tz);
}

export type RangeDraft = { from: string; to: string };

/** 輸入的起訖（含結束那一秒）→ 查詢用 [from, to) epoch；不合法回錯誤訊息 */
export function rangeToQuery(draft: RangeDraft, tz: string): { from: number; to: number } | { error: string } {
  const from = localInputToEpoch(draft.from, tz);
  const to = localInputToEpoch(draft.to, tz);
  if (from === null) return { error: '請選擇開始時間' };
  if (to === null) return { error: '請選擇結束時間' };
  if (to < from) return { error: '結束時間不能早於開始時間' };
  return { from, to: to + 1_000 };
}

export function recentRange(ms: number, tz: string, now = Date.now()): RangeDraft {
  return { from: toLocalInput(now - ms, tz), to: toLocalInput(now, tz) };
}

export function timeZoneLabel(tz: string, now = Date.now()) {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(now)).find((p) => p.type === 'timeZoneName')?.value;
    return `${tz}（${(offset ?? 'GMT').replace('GMT', 'UTC') || 'UTC'}）`;
  } catch {
    return tz;
  }
}
