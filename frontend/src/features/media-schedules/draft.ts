import { SCHEDULE_NAME_MAX, type PlaylistItem, type ScheduleDetail, type ScheduleInput, type ScheduleMode, type Weekly } from './api';

/**
 * 媒體排程表單的純邏輯：草稿、驗證、送出內容、時間顯示。
 * 本地時間一律依排程的時區解讀（Intl），不看瀏覽器或主機時區。
 */
export const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
export const PLAYLIST_MAX = 100;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MODE_LABEL: Record<ScheduleMode, string> = { reserved: '預約播放', timed: '定時播放' };

export function weekdayLabel(day: string) {
  return `週${'一二三四五六日'[Number(day) - 1] ?? '?'}`;
}

export type Draft = {
  name: string;
  mode: ScheduleMode;
  timeZone: string;
  /** 預約：YYYY-MM-DDTHH:mm（排程時區） */
  runLocal: string;
  startDate: string;
  endDate: string;
  weekly: Weekly;
  targetScope: 'all' | 'vehicles';
  vehicleIds: string[];
  items: PlaylistItem[];
  sourceGroup: { id: string; name: string; version: number } | null;
};

export function emptyDraft(timeZone: string): Draft {
  return { name: '', mode: 'reserved', timeZone, runLocal: '', startDate: '', endDate: '', weekly: {}, targetScope: 'all', vehicleIds: [], items: [], sourceGroup: null };
}

/** 編輯：完整還原（含兩種模式的欄位都放回草稿，切換模式時不會遺失；送出時只送生效模式） */
export function draftFromDetail(detail: ScheduleDetail): Draft {
  return {
    name: detail.name,
    mode: detail.mode,
    timeZone: detail.time_zone,
    runLocal: detail.run_local ?? '',
    startDate: detail.start_date ?? '',
    endDate: detail.end_date ?? '',
    weekly: detail.weekly ?? {},
    targetScope: detail.target_scope,
    vehicleIds: detail.target_scope === 'vehicles' ? detail.vehicles.map((v) => v.id) : [],
    items: detail.items,
    sourceGroup: detail.source_group ? { id: detail.source_group.id, name: detail.source_group.name, version: detail.source_group.version } : null,
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function zoned(epoch: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(epoch))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 絕對時刻在排程時區的 YYYY-MM-DD HH:mm */
export function formatInZone(epoch: number, tz: string) {
  const z = zoned(epoch, tz);
  return `${z.date} ${z.time}`;
}

/** 此刻在排程時區的 YYYY-MM-DDTHH:mm（判斷預約時間是否已過；以分鐘為單位） */
export function nowLocal(tz: string, now: number) {
  const z = zoned(now, tz);
  return `${z.date}T${z.time}`;
}

/** 每天的時間：空白與重複標在該列；回傳每列的錯誤（無錯誤為 null） */
export function dayTimeErrors(times: string[]): Array<string | null> {
  const seen = new Map<string, number>();
  return times.map((time, index) => {
    if (!time) return '請選擇時間';
    if (!TIME_RE.test(time)) return '時間格式不正確';
    if (seen.has(time)) return `與第 ${seen.get(time)! + 1} 個時間重複`;
    seen.set(time, index);
    return null;
  });
}

export function sortWeekly(weekly: Weekly): Weekly {
  const out: Weekly = {};
  for (const day of WEEKDAYS) if (weekly[day]?.length) out[day] = [...weekly[day]].sort();
  return out;
}

export function weeklySummary(weekly: Weekly) {
  return WEEKDAYS.filter((day) => weekly[day]?.length).map((day) => `${weekdayLabel(day)} ${weekly[day].join('、')}`).join('；');
}

export type DraftErrors = Partial<Record<'name' | 'runLocal' | 'startDate' | 'endDate' | 'weekly' | 'vehicles' | 'items', string>>;

/**
 * 前端先擋一次（後端會再驗一次）。預約時間已過：只有建立、或編輯時改了時間才擋；
 * 已過期的預約改名稱等其他欄位不用被迫改時間。
 */
export function validateDraft(draft: Draft, context: { now: number; originalRunLocal: string | null }): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = '請輸入排程名稱';
  else if (name.length > SCHEDULE_NAME_MAX) errors.name = `排程名稱最多 ${SCHEDULE_NAME_MAX} 字`;
  if (draft.mode === 'reserved') {
    if (!draft.runLocal) errors.runLocal = '請選擇開始時間';
    else if (draft.runLocal !== context.originalRunLocal && draft.runLocal <= nowLocal(draft.timeZone, context.now)) errors.runLocal = '預約時間必須晚於現在';
  } else {
    if (!DATE_RE.test(draft.startDate)) errors.startDate = '請選擇開始日期';
    if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) errors.endDate = '結束日期不得早於開始日期';
    const days = WEEKDAYS.filter((day) => draft.weekly[day]?.length);
    if (!days.length) errors.weekly = '請至少選擇一個星期並設定時間';
    else if (days.some((day) => dayTimeErrors(draft.weekly[day]).some(Boolean))) errors.weekly = '播放時間有空白或重複，請重新設定';
  }
  if (draft.targetScope === 'vehicles' && !draft.vehicleIds.length) errors.vehicles = '請至少指定一台載具';
  if (!draft.items.length) errors.items = '播放清單至少要有一個媒體';
  else if (draft.items.length > PLAYLIST_MAX) errors.items = `播放清單最多 ${PLAYLIST_MAX} 個媒體`;
  else if (draft.items.some((item) => item.missing || !item.available)) errors.items = '播放清單有無法播放的媒體，請移除後再儲存';
  return errors;
}

/** 送出內容：只帶生效模式的欄位，另一模式的草稿不送 */
export function toInput(draft: Draft, version?: number): ScheduleInput {
  const common = {
    name: draft.name.trim(),
    mode: draft.mode,
    time_zone: draft.timeZone,
    target_scope: draft.targetScope,
    vehicle_ids: draft.targetScope === 'vehicles' ? draft.vehicleIds : [],
    media_ids: draft.items.map((item) => item.id),
    source_group: draft.sourceGroup ? { id: draft.sourceGroup.id, version: draft.sourceGroup.version } : null,
    ...(version === undefined ? {} : { expected_version: version }),
  };
  return draft.mode === 'reserved'
    ? { ...common, run_local: draft.runLocal }
    : { ...common, start_date: draft.startDate, end_date: draft.endDate || null, weekly: sortWeekly(draft.weekly) };
}

/** 時區顯示：Asia/Taipei（UTC+08:00） */
export function timeZoneLabel(tz: string, now: number) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(now)).find((p) => p.type === 'timeZoneName')?.value;
    return `${tz}（${(part ?? 'GMT').replace('GMT', 'UTC') || 'UTC'}）`;
  } catch {
    return tz;
  }
}
