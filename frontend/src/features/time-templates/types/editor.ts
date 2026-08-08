import { recommendFleetRowCount } from '../utils/recommendFleetRowCount';

export const VEHICLE_CAPACITY_MIN = 1;
export const VEHICLE_CAPACITY_MAX = 200;
export const VEHICLE_CAPACITY_DEFAULT = 50;
export const VEHICLE_CAPACITY_MARKS = [50, 100, 150, 200] as const;

export function computeCapacityPphpd(
  vehicleCapacity: number,
  headwaySeconds: number | null,
): number {
  if (headwaySeconds == null || headwaySeconds <= 0) return 0;
  return Math.round((vehicleCapacity * 3600) / headwaySeconds);
}

/** pphpd 反推等效班距（秒）；與 computeCapacityPphpd 互為近似反運算 */
export function computeHeadwaySecondsFromPphpd(
  vehicleCapacity: number,
  pphpd: number | null,
): number | null {
  if (pphpd == null || pphpd <= 0 || vehicleCapacity <= 0) return null;
  return Math.round((vehicleCapacity * 3600) / pphpd);
}

export type TimeSlotAttribute = {
  id: string;
  name: string;
  color: string;
  headwaySeconds: number | null;
  capacityPphpd: number;
  isDraft: boolean;
};

export const ATTRIBUTE_COLOR_PALETTE = [
  '#90A1B9',
  '#9AE600',
  '#05DF72',
  '#00D492',
  '#00D5BE',
  '#00D3F2',
  '#00BCFF',
  '#51A2FF',
  '#7C86FF',
  '#A684FF',
  '#C27AFF',
  '#ED6BFF',
  '#FB64B6',
  '#FF637E',
  '#FF6467',
  '#FF8904',
  '#FFBA00',
  '#FFDF20',
] as const;

export function defaultAttributeColor(index: number): string {
  return ATTRIBUTE_COLOR_PALETTE[index % ATTRIBUTE_COLOR_PALETTE.length];
}

export function createDraftAttribute(index: number): TimeSlotAttribute {
  return {
    id: `attr-${Date.now()}`,
    name: '',
    color: defaultAttributeColor(index),
    headwaySeconds: null,
    capacityPphpd: 0,
    isDraft: true,
  };
}

export function formatHeadwayLabel(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  return `${seconds} 秒`;
}

export function formatCapacityLabel(pphpd: number): string {
  return `${pphpd.toLocaleString('en-US')} pphpd`;
}

export type TimeSlotInterval = {
  id: string;
  attributeId: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isDraft: boolean;
};

export function createDraftInterval(attributeId = ''): TimeSlotInterval {
  return {
    id: `slot-${Date.now()}`,
    attributeId,
    name: '',
    startTime: '',
    endTime: '',
    isDraft: true,
  };
}

export function intervalDurationTableLabel(startTime: string, endTime: string): string {
  const start = parseIntervalStartMinutes(startTime);
  const end = parseIntervalEndMinutes(endTime);
  if (start == null || end == null || end <= start) return '0小時';
  const mins = end - start;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  if (hh === 0 && mm === 0) return '0小時';
  if (mm === 0) return `${hh}小時`;
  if (hh === 0) return `${mm}分鐘`;
  return `${hh}小時${mm}分鐘`;
}

/**
 * 整備任務固定五類（充電／洗車／保養／行前／機動），各自在場域設定 step 2
 * 有對應設施分類，加上正線共六種。
 *
 * 洗車（`washing`）與保養（`servicing`）是<strong>各自獨立</strong>的類型：
 * 模板上排洗車就是洗車、排保養就是保養，不再是「休息窗口內由系統決定」。
 * 兩者的整備設施不同（洗車 W 系、保養 M 系），出場站因此也不同。
 */
export type TaskTypeKey =
  | 'passenger'
  | 'charging'
  | 'inspection'
  | 'standby'
  | 'servicing'
  | 'washing';

/** 排班引擎產物：過渡空檔沿用 idle；調度＝整備後開往首班起點站 */
export type ScheduleEngineTaskType = TaskTypeKey | 'idle' | 'dispatch';

export const TASK_TYPE_OPTIONS: Array<{
  key: TaskTypeKey;
  label: string;
}> = [
  { key: 'passenger', label: '正線' },
  { key: 'charging', label: '充電' },
  { key: 'inspection', label: '行前' },
  { key: 'standby', label: '機動' },
  { key: 'servicing', label: '保養' },
  { key: 'washing', label: '洗車' },
];

/** 時間模板任務類型說明（側欄 chip 提示用） */
export const TASK_TYPE_DESCRIPTIONS: Record<
  TaskTypeKey,
  { title: string; bullets: string[] }
> = {
  passenger: {
    title: '正線',
    bullets: [
      '於模板固定排定載客正線勤務時段',
      '班表製作時媒合地圖正線路線與各站停靠',
      '實際占用時間依路線行駛＋停靠計算',
    ],
  },
  charging: {
    title: '充電',
    bullets: [
      '於模板預排充電時段（營運策略由人工排定）',
      '進入保養窗口時，充電優先於里程／條件判斷',
      '不綁定整備路線；占用以模板時段長度為準',
    ],
  },
  inspection: {
    title: '行前',
    bullets: [
      '於模板固定排出車前檢查時段',
      '可參考整備任務「行前」的預估作業時間',
      '通常安排於當日勤務開始前',
    ],
  },
  standby: {
    title: '機動',
    bullets: [
      '於模板固定排機動／調度待命時段',
      '可參考整備任務「機動」的預估作業時間',
      '占用以模板時段長度為準',
    ],
  },
  servicing: {
    title: '保養',
    bullets: [
      '於模板固定排保養時段（對應整備設施 M 系）',
      '可參考整備任務「保養」的預估作業時間',
      '結束後由出場移動卡（MEX）把車開到該設施的轉乘站',
    ],
  },
  washing: {
    title: '洗車',
    bullets: [
      '於模板固定排洗車時段（對應整備設施 W 系）',
      '可參考整備任務「洗車」的預估作業時間',
      '結束後由出場移動卡（WEX）把車開到該設施的轉乘站',
    ],
  },
};

/**
 * 舊資料的任務類型代碼。`wash` 早年就是洗車，現在洗車有了自己的
 * `washing` 類型，直譯回去比併進保養忠實（併進保養會讓車被算成從
 * M 系設施出場，實際上它在 W 系）。`idle`／`maintenance` 沒有更貼切的
 * 對應，仍歸保養。
 */
const LEGACY_SCHEDULE_TASK_TYPE_MAP: Record<string, TaskTypeKey> = {
  idle: 'servicing',
  maintenance: 'servicing',
  wash: 'washing',
};

export function migrateLegacyScheduleTaskType(raw: unknown): TaskTypeKey | null {
  if (typeof raw !== 'string') return null;
  const mapped = LEGACY_SCHEDULE_TASK_TYPE_MAP[raw];
  if (mapped) return mapped;
  return parseTaskTypeKey(raw);
}

export function parseTaskTypeKey(raw: unknown): TaskTypeKey | null {
  if (typeof raw !== 'string') return null;
  return TASK_TYPE_OPTIONS.some((item) => item.key === raw) ? (raw as TaskTypeKey) : null;
}

export function resolveTaskTypeLabel(key: TaskTypeKey | null | undefined): string {
  if (!key) return '未設定';
  return TASK_TYPE_OPTIONS.find((item) => item.key === key)?.label ?? key;
}

export function isMainlineTaskType(key: TaskTypeKey | null | undefined): boolean {
  return key === 'passenger';
}

export function isServicingWindowTaskType(key: TaskTypeKey | null | undefined): boolean {
  return key === 'servicing' || key === 'washing';
}

export const PERIOD_LEGEND_FALLBACK: Array<{ label: string; chipClass: string }> = [
  { label: '凌晨時段', chipClass: 'border-violet-500/40 bg-violet-500/20 text-violet-200' },
  { label: '離峰時段', chipClass: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200' },
  { label: '尖峰時段', chipClass: 'border-orange-500/40 bg-orange-500/20 text-orange-200' },
];

export const PERIOD_CHIP_CLASSES = [
  'border-violet-500/40 bg-violet-500/20 text-violet-200',
  'border-emerald-500/40 bg-emerald-500/20 text-emerald-200',
  'border-orange-500/40 bg-orange-500/20 text-orange-200',
  'border-sky-500/40 bg-sky-500/20 text-sky-200',
  'border-amber-500/40 bg-amber-500/20 text-amber-200',
];

export const ATTRIBUTES_PANEL_HEIGHT_PX = 132;
/**
 * 步驟列與「時段屬性」面板頂部之間的距離（px）。
 * 調小 → 整塊時段屬性面板往上移動（不會蓋住步驟列）。
 */
export const ATTRIBUTES_PANEL_TOP_GAP_PX = 2;
/** 面板頂部內距；調小 → 標題＋卡片在面板內部往上 */
export const ATTRIBUTES_PANEL_PADDING_TOP_PX = 3;
/** 標題列（時段屬性／滑桿／新增）上方額外內距 */
export const ATTRIBUTES_PANEL_HEADER_PADDING_TOP_PX = 4;
/** Step1「時段屬性」與「時段區間」兩塊之間的間距 */
export const STEP_OPERATING_SLOTS_GAP_PX = 8;
/** 步驟列（營運時段／任務排班／整體預覽）與下方內容區的間距 */
export const CREATE_TEMPLATE_STEPPER_CONTENT_GAP_PX = 12;
export const ATTRIBUTE_CARD_WIDTH_PX = 180;
export const ATTRIBUTE_CARD_HEIGHT_PX = 80;
export const ATTRIBUTE_CARD_HEADER_ROW_PX = 28;
export const ATTRIBUTE_CARD_FIELD_HEIGHT_PX = 22;

/** Step 1「時段設定」時間軸區塊（原 100px 外框 × 0.85） */
export const INTERVAL_TIMELINE_HEIGHT_PX = 68;
export const INTERVAL_TIMELINE_INNER_HEIGHT_PX = 77; // 90px × 0.85
export const INTERVAL_TIMELINE_AXIS_HEIGHT_PX = 23; // 38px × 0.85
export const INTERVAL_TIMELINE_ROW_HEIGHT_PX = 43; // 51px × 0.85
export const INTERVAL_TIMELINE_BAR_HEIGHT_PX = 43; // 50px × 0.85

export const INTERVAL_TABLE_HEADER_HEIGHT_PX = 30;
/** 清單每一列：下拉／時間輸入框高度 */
export const INTERVAL_TABLE_FIELD_HEIGHT_PX = 26;
/** 清單每一列：儲存格上下內距 */
export const INTERVAL_TABLE_ROW_PADDING_Y_PX = 6;
/** 清單每一列：確認／編輯／刪除按鈕尺寸 */
export const INTERVAL_TABLE_ACTION_SIZE_PX = 32;
/** 「時段區間」面板最小高度；有剩餘空間時會自動撐滿到底部 */
export const INTERVALS_PANEL_HEIGHT_PX = 368;
/** Modal 內容區底部內距（調小可讓時段區間更靠近 footer） */
export const CREATE_TEMPLATE_MODAL_CONTENT_PADDING_BOTTOM_PX = 0;

export const SCHEDULE_ROW_COUNT_INITIAL = 1;
export const SCHEDULE_ROW_COUNT_MAX = 99;
export const SCHEDULE_SLOT_MINUTES = 30;
export const SCHEDULE_VISIBLE_SLOTS = 48; // 24h × 30min
export const SCHEDULE_DAY_MINUTES = 24 * 60;
export const SCHEDULE_SLOT_WIDTH_DEFAULT = 144; // 120px × 1.2
/** 時軸縮放滑桿最左：預設寬度的 1/3.5；最右：預設寬度。 */
export const SCHEDULE_SLOT_WIDTH_ZOOM_FACTOR = 3.5;
export const SCHEDULE_SLOT_WIDTH_MIN = SCHEDULE_SLOT_WIDTH_DEFAULT / SCHEDULE_SLOT_WIDTH_ZOOM_FACTOR;

/** 班表時軸刻度文字色（00:00、00:30…） */
export const SCHEDULE_TIME_AXIS_TEXT_CLASS = 'text-[#F3F4F6]';
/** 無營運時段上的時軸刻度 */
export const SCHEDULE_TIME_AXIS_TEXT_INACTIVE_CLASS = 'text-[#9CA3AF]';

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(124, 134, 255, ${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Opaque mix of accent on base — covers inactive stripe layer underneath. */
export function blendHexOnBase(
  hex: string,
  amount: number,
  baseHex = '#141417',
): string {
  const parse = (color: string): [number, number, number] => {
    const n = color.replace('#', '');
    if (n.length !== 6) return [20, 20, 23];
    return [
      Number.parseInt(n.slice(0, 2), 16),
      Number.parseInt(n.slice(2, 4), 16),
      Number.parseInt(n.slice(4, 6), 16),
    ];
  };
  const [br, bg, bb] = parse(baseHex);
  const [fr, fg, fb] = parse(hex);
  const t = Math.min(1, Math.max(0, amount));
  return `rgb(${Math.round(br * (1 - t) + fr * t)}, ${Math.round(bg * (1 - t) + fg * t)}, ${Math.round(bb * (1 - t) + fb * t)})`;
}

/** Figma TaskBar: base + 16% tint → opaque fill (no bleed over grid). */
export function taskTypeBarBackground(
  baseHex: string,
  tintRgb: [number, number, number],
  tintAlpha = 0.16,
): string {
  const tintHex = `#${tintRgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return blendHexOnBase(tintHex, tintAlpha, baseHex);
}

export type MinuteRange = { start: number; end: number };

export function parseIntervalMinuteRanges(intervals: TimeSlotInterval[]): MinuteRange[] {
  return intervals
    .map((slot) => {
      const start = parseIntervalStartMinutes(slot.startTime);
      const end = parseIntervalEndMinutes(slot.endTime);
      if (start == null || end == null || end <= start) return null;
      return { start, end };
    })
    .filter((range): range is MinuteRange => range != null)
    .sort((a, b) => a.start - b.start);
}

function mergeMinuteRanges(ranges: MinuteRange[]): MinuteRange[] {
  if (ranges.length === 0) return [];
  const merged: MinuteRange[] = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i += 1) {
    const prev = merged[merged.length - 1];
    const cur = ranges[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Portions of [barStart, barEnd) that fall outside all active operating intervals. */
export function getInactiveRangesWithinBar(
  barStart: number,
  barEnd: number,
  activeRanges: MinuteRange[],
): MinuteRange[] {
  if (barEnd <= barStart) return [];
  const merged = mergeMinuteRanges(activeRanges);
  if (merged.length === 0) {
    return [{ start: barStart, end: barEnd }];
  }

  const inactive: MinuteRange[] = [];
  let cursor = barStart;

  for (const active of merged) {
    if (active.end <= barStart) continue;
    if (active.start >= barEnd) break;

    const gapEnd = Math.min(active.start, barEnd);
    if (gapEnd > cursor) {
      inactive.push({ start: cursor, end: gapEnd });
    }
    cursor = Math.max(cursor, active.end);
    if (cursor >= barEnd) return inactive;
  }

  if (cursor < barEnd) {
    inactive.push({ start: cursor, end: barEnd });
  }
  return inactive;
}

/** True when [start, end) lies entirely inside active operating intervals. */
export function isRangeWithinActiveIntervals(
  start: number,
  end: number,
  activeRanges: MinuteRange[],
): boolean {
  if (end <= start) return false;
  if (activeRanges.length === 0) return false;
  return getInactiveRangesWithinBar(start, end, activeRanges).length === 0;
}

export function isScheduleSlotActive(
  col: number,
  durationMinutes: number,
  activeRanges: MinuteRange[],
): boolean {
  const start = col * SCHEDULE_SLOT_MINUTES;
  return isRangeWithinActiveIntervals(start, start + durationMinutes, activeRanges);
}

export const SCHEDULE_TASK_MIN_DURATION_MINUTES = 1;

/** 時刻刻度（秒）：與排班引擎 S3 整點對齊一致，允許 x分00／10／20／30／40／50 秒 */
export const SCHEDULE_TIME_ALIGN_SECONDS = 10;

export function snapSecondsToScheduleAlign(seconds: number): number {
  if (SCHEDULE_TIME_ALIGN_SECONDS <= 0) return Math.round(seconds);
  return Math.round(seconds / SCHEDULE_TIME_ALIGN_SECONDS) * SCHEDULE_TIME_ALIGN_SECONDS;
}

/** 將分鐘值對齊到 10 秒格（例如 2分05秒 → 2分10秒，不會變成 3分） */
export function clampScheduleMinute(minute: number): number {
  const clamped = Math.min(SCHEDULE_DAY_MINUTES, Math.max(0, minute));
  const snappedSeconds = snapSecondsToScheduleAlign(Math.round(clamped * 60));
  return Math.min(SCHEDULE_DAY_MINUTES, Math.max(0, snappedSeconds / 60));
}

export function clampRangeEndToActiveIntervals(
  start: number,
  proposedEnd: number,
  activeRanges: MinuteRange[],
): number {
  let end = clampScheduleMinute(
    Math.max(start + SCHEDULE_TASK_MIN_DURATION_MINUTES, proposedEnd),
  );
  while (
    end > start + SCHEDULE_TASK_MIN_DURATION_MINUTES
    && !isRangeWithinActiveIntervals(start, end, activeRanges)
  ) {
    end -= 1;
  }
  return end;
}

export function clampRangeStartToActiveIntervals(
  proposedStart: number,
  end: number,
  activeRanges: MinuteRange[],
): number {
  let start = clampScheduleMinute(
    Math.min(end - SCHEDULE_TASK_MIN_DURATION_MINUTES, proposedStart),
  );
  while (
    start < end - SCHEDULE_TASK_MIN_DURATION_MINUTES
    && !isRangeWithinActiveIntervals(start, end, activeRanges)
  ) {
    start += 1;
  }
  return start;
}

export function snapMinuteToScheduleSlot(minute: number): number {
  return Math.round(minute / SCHEDULE_SLOT_MINUTES) * SCHEDULE_SLOT_MINUTES;
}

export function normalizeScheduleTask(task: ScheduleTask): ScheduleTask {
  const start = clampScheduleMinute(
    Math.min(task.startMinute, SCHEDULE_DAY_MINUTES - SCHEDULE_TASK_MIN_DURATION_MINUTES),
  );
  const minDurationSeconds = SCHEDULE_TASK_MIN_DURATION_MINUTES * 60;
  let durationSeconds = snapSecondsToScheduleAlign(Math.round(task.durationMinutes * 60));
  durationSeconds = Math.max(minDurationSeconds, durationSeconds);
  const maxDurationSeconds = Math.round((SCHEDULE_DAY_MINUTES - start) * 60);
  durationSeconds = Math.min(durationSeconds, maxDurationSeconds);
  durationSeconds = snapSecondsToScheduleAlign(durationSeconds);
  const duration = durationSeconds / 60;
  const option = TASK_TYPE_OPTIONS.find((t) => t.key === task.taskType);
  return {
    ...task,
    startMinute: start,
    durationMinutes: duration,
    label: option?.label ?? task.label,
  };
}

export function updateScheduleTask(
  tasks: ScheduleTask[],
  taskId: string,
  patch: Partial<ScheduleTask>,
): ScheduleTask[] {
  return tasks.map((task) =>
    task.id === taskId ? normalizeScheduleTask({ ...task, ...patch }) : task,
  );
}

/** True when [start, end) overlaps another task on the same row (excluding taskId). */
export function findScheduleTaskOverlap(
  taskId: string,
  rowIndex: number,
  startMinute: number,
  endMinute: number,
  tasks: ScheduleTask[],
): boolean {
  if (endMinute <= startMinute) return false;
  return tasks.some((other) => {
    if (other.id === taskId) return false;
    if (other.rowIndex !== rowIndex) return false;
    const otherStart = other.startMinute;
    const otherEnd = other.startMinute + other.durationMinutes;
    return startMinute < otherEnd && otherStart < endMinute;
  });
}

/** 拉伸右緣時，不可延伸到同列其他任務的開始時間之前 */
export function clampRangeEndAwayFromOverlappingTasks(
  taskId: string,
  rowIndex: number,
  start: number,
  proposedEnd: number,
  tasks: ScheduleTask[],
): number {
  let end = proposedEnd;
  for (const other of tasks) {
    if (other.id === taskId || other.rowIndex !== rowIndex) continue;
    const otherStart = other.startMinute;
    if (otherStart > start && end > otherStart) {
      end = otherStart;
    }
  }
  return Math.max(start + SCHEDULE_TASK_MIN_DURATION_MINUTES, end);
}

/** 拉伸左緣時，不可延伸到同列其他任務的結束時間之後 */
export function clampRangeStartAwayFromOverlappingTasks(
  taskId: string,
  rowIndex: number,
  proposedStart: number,
  end: number,
  tasks: ScheduleTask[],
): number {
  let start = proposedStart;
  for (const other of tasks) {
    if (other.id === taskId || other.rowIndex !== rowIndex) continue;
    const otherEnd = other.startMinute + other.durationMinutes;
    if (otherEnd < end && start < otherEnd) {
      start = otherEnd;
    }
  }
  return Math.min(end - SCHEDULE_TASK_MIN_DURATION_MINUTES, start);
}

/** 水平拖移任務時，在維持時長不變的前提下取得合法開始分鐘。 */
export function clampTaskMoveStart(
  taskId: string,
  rowIndex: number,
  duration: number,
  proposedStart: number,
  activeRanges: MinuteRange[],
  tasks: ScheduleTask[],
): number {
  let start = clampScheduleMinute(
    Math.max(0, Math.min(SCHEDULE_DAY_MINUTES - duration, proposedStart)),
  );
  let end = start + duration;

  start = clampRangeStartAwayFromOverlappingTasks(taskId, rowIndex, start, end, tasks);
  end = start + duration;
  end = clampRangeEndAwayFromOverlappingTasks(taskId, rowIndex, start, end, tasks);
  start = end - duration;

  start = clampRangeStartToActiveIntervals(start, end, activeRanges);
  end = start + duration;
  if (!isRangeWithinActiveIntervals(start, end, activeRanges)) {
    end = clampRangeEndToActiveIntervals(start, end, activeRanges);
    start = end - duration;
    start = clampRangeStartToActiveIntervals(start, end, activeRanges);
  }

  return Math.max(0, Math.min(SCHEDULE_DAY_MINUTES - duration, start));
}

/* ── Schedule Task (Step 2) ── */

export type ScheduleTask = {
  id: string;
  rowIndex: number;        // 1-based row (vehicle number)
  taskType: TaskTypeKey;
  startMinute: number;     // minutes from 00:00
  durationMinutes: number; // default 30
  label: string;           // task display name
  /**
   * 模板原始開始（分鐘）。引擎讓渡／進場溢出可能把 `startMinute` 往後推；
   * 保留此值讓後續讓渡可在幽靈正線被推走後縮回模板開頭。
   */
  templateStartMinute?: number;
};

/** Figma TaskBar colors — opaque bg so bars don't shift hue over the grid. */
export const TASK_TYPE_COLORS: Record<
  TaskTypeKey,
  { bar: string; base: string; bg: string; text: string }
> = {
  inspection: {
    bar: '#EFB100',
    base: '#42381E',
    bg: taskTypeBarBackground('#42381E', [239, 177, 0]),
    text: '#F3F4F6',
  },
  passenger: {
    bar: '#2B7FFF',
    base: '#1D2F4E',
    bg: taskTypeBarBackground('#1D2F4E', [43, 127, 255]),
    text: '#F3F4F6',
  },
  charging: {
    bar: '#00C951',
    base: '#1C3C2B',
    bg: taskTypeBarBackground('#1C3C2B', [0, 201, 81]),
    text: '#F3F4F6',
  },
  servicing: {
    bar: '#AD46FF',
    base: '#382747',
    bg: taskTypeBarBackground('#382747', [173, 70, 255]),
    text: '#F3F4F6',
  },
  standby: {
    bar: '#FF6900',
    base: '#462E1F',
    bg: taskTypeBarBackground('#462E1F', [255, 105, 0]),
    text: '#F3F4F6',
  },
  washing: {
    bar: '#00B8DB',
    base: '#123C46',
    bg: taskTypeBarBackground('#123C46', [0, 184, 219]),
    text: '#F3F4F6',
  },
};

export type TaskTypeColorSet = {
  bar: string;
  base: string;
  bg: string;
  text: string;
};

/** 排班引擎區塊用色（含過渡 idle） */
export const SCHEDULE_ENGINE_TASK_TYPE_COLORS: Record<ScheduleEngineTaskType, TaskTypeColorSet> = {
  ...TASK_TYPE_COLORS,
  idle: {
    bar: '#52525B',
    base: '#27272A',
    bg: taskTypeBarBackground('#27272A', [82, 82, 91]),
    text: '#A1A1AA',
  },
  dispatch: {
    bar: '#38BDF8',
    base: '#0C4A6E',
    bg: taskTypeBarBackground('#0C4A6E', [56, 189, 248]),
    text: '#BAE6FD',
  },
};

export function resolveScheduleEngineTaskTypeColors(
  taskType: ScheduleEngineTaskType | null | undefined,
): TaskTypeColorSet | null {
  if (!taskType) return null;
  return SCHEDULE_ENGINE_TASK_TYPE_COLORS[taskType] ?? null;
}

/**
 * 進場載客（保養尾端長出、載客開往首班起點站）專用色卡。
 * 與正線藍、保養紫、調度天藍區隔（青綠）；為 source 級用色，不歸任務類型。
 */
export const ENTRY_SERVICE_COLOR_SET: TaskTypeColorSet = {
  bar: '#2DD4BF',
  base: '#0F3D3A',
  bg: taskTypeBarBackground('#0F3D3A', [45, 212, 191]),
  text: '#99F6E4',
};

/**
 * 出場移動卡（整備設施 → 轉乘站）專用色卡。
 * 這種卡常常只有 30 秒，畫出來是幾個 px 的細條，所以用高彩度實心色
 * 讓它在整備卡與正線卡之間仍然看得出來；內容全部交給 hover。
 */
export const YARD_EXIT_MOVE_COLOR_SET: TaskTypeColorSet = {
  bar: '#FACC15',
  base: '#4A3B0B',
  bg: '#B4890F',
  text: '#1F1400',
};

export function migrateScheduleTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.map((task) => {
    const taskType = migrateLegacyScheduleTaskType(task.taskType) ?? 'servicing';
    return normalizeScheduleTask({ ...task, taskType });
  });
}

export function createScheduleTask(
  rowIndex: number,
  taskType: TaskTypeKey,
  startMinute: number,
): ScheduleTask {
  const option = TASK_TYPE_OPTIONS.find((t) => t.key === taskType);
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    rowIndex,
    taskType,
    startMinute,
    durationMinutes: SCHEDULE_SLOT_MINUTES,
    label: option?.label ?? taskType,
  };
}

/** 單列在營運時段內、尚未被任務覆蓋的時間區間。 */
export function computeUncoveredRangesForRow(
  rowIndex: number,
  tasks: ScheduleTask[],
  activeRanges: MinuteRange[],
): MinuteRange[] {
  if (activeRanges.length === 0) return [];

  const rowTasks = tasks
    .filter((task) => task.rowIndex === rowIndex)
    .map((task) => ({
      start: task.startMinute,
      end: task.startMinute + task.durationMinutes,
    }))
    .sort((a, b) => a.start - b.start);

  const mergedActive = mergeMinuteRanges(activeRanges);
  const uncovered: MinuteRange[] = [];

  for (const active of mergedActive) {
    let cursor = active.start;
    for (const task of rowTasks) {
      if (task.end <= active.start) continue;
      if (task.start >= active.end) break;

      const gapEnd = Math.min(task.start, active.end);
      if (gapEnd > cursor) {
        uncovered.push({ start: cursor, end: gapEnd });
      }
      cursor = Math.max(cursor, task.end);
      if (cursor >= active.end) break;
    }
    if (cursor < active.end) {
      uncovered.push({ start: cursor, end: active.end });
    }
  }

  return uncovered;
}

/** 營運時段內、尚無任務覆蓋的缺漏（含列號）。 */
export type ScheduleTimeGap = MinuteRange & {
  rowIndex: number;
};

/** 列出所有列在營運時段內的時間缺漏（短於最小任務時長者略過）。 */
export function listScheduleTimeGaps(
  rowCount: number,
  tasks: ScheduleTask[],
  activeRanges: MinuteRange[],
  minDurationMinutes = SCHEDULE_TASK_MIN_DURATION_MINUTES,
): ScheduleTimeGap[] {
  if (rowCount <= 0 || activeRanges.length === 0) return [];
  const gaps: ScheduleTimeGap[] = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (const range of computeUncoveredRangesForRow(rowIndex, tasks, activeRanges)) {
      if (range.end - range.start < minDurationMinutes) continue;
      gaps.push({ rowIndex, start: range.start, end: range.end });
    }
  }
  return gaps;
}

/** 為所有列的營運時段空餘時間建立填補任務。 */
export function buildTasksToFillEmptyScheduleSlots(
  rowCount: number,
  tasks: ScheduleTask[],
  activeRanges: MinuteRange[],
  taskType: TaskTypeKey,
): ScheduleTask[] {
  if (rowCount <= 0 || activeRanges.length === 0) return [];

  const option = TASK_TYPE_OPTIONS.find((t) => t.key === taskType);
  const created: ScheduleTask[] = [];
  let seq = 0;

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const gaps = computeUncoveredRangesForRow(rowIndex, tasks, activeRanges);
    for (const gap of gaps) {
      const durationMinutes = gap.end - gap.start;
      if (durationMinutes < SCHEDULE_TASK_MIN_DURATION_MINUTES) continue;
      created.push(
        normalizeScheduleTask({
          id: `task-fill-${Date.now()}-${seq}-${rowIndex}-${gap.start}`,
          rowIndex,
          taskType,
          startMinute: gap.start,
          durationMinutes,
          label: option?.label ?? taskType,
        }),
      );
      seq += 1;
    }
  }

  return created;
}

export function formatMinutesToTime(minutes: number): string {
  const totalSeconds = snapSecondsToScheduleAlign(Math.round(minutes * 60));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  if (ss === 0) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function parseTimeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] != null ? Number(m[3]) : 0;
  if (hh > 24 || mm > 59) return null;
  if (ss > 59) return null;
  if (hh === 24 && (mm > 0 || ss > 0)) return null;
  const totalSeconds = snapSecondsToScheduleAlign(hh * 3600 + mm * 60 + ss);
  if (totalSeconds > SCHEDULE_DAY_MINUTES * 60) return null;
  return totalSeconds / 60;
}

/** Start of an operating interval (00:00 = day start; 24:00 invalid). */
export function parseIntervalStartMinutes(time: string): number | null {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null || minutes >= SCHEDULE_DAY_MINUTES) return null;
  return minutes;
}

/** End of an operating interval (00:00 / 24:00 = end of day). */
export function parseIntervalEndMinutes(time: string): number | null {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null) return null;
  if (minutes === 0 || minutes === SCHEDULE_DAY_MINUTES) return SCHEDULE_DAY_MINUTES;
  if (minutes > SCHEDULE_DAY_MINUTES) return null;
  return minutes;
}

export function isValidIntervalRange(startTime: string, endTime: string): boolean {
  const start = parseIntervalStartMinutes(startTime);
  const end = parseIntervalEndMinutes(endTime);
  return start != null && end != null && end > start;
}

export function formatMinutesAsDuration(totalMinutes: number): string {
  const mins = Math.max(0, totalMinutes);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  if (hh === 0) return `${mm} 分鐘`;
  if (mm === 0) return `${hh} 小時`;
  return `${hh} 小時 ${mm} 分鐘`;
}

export function intervalDurationLabel(startTime: string, endTime: string): string {
  const start = parseIntervalStartMinutes(startTime);
  const end = parseIntervalEndMinutes(endTime);
  if (start == null || end == null || end <= start) return '—';
  return formatMinutesAsDuration(end - start);
}

export type TimeTemplateEditorDraft = {
  name: string;
  vehicleCapacity: number;
  attributes: TimeSlotAttribute[];
  intervals: TimeSlotInterval[];
  tasks: ScheduleTask[];
  scheduleRowCount: number;
};

export type CreateTemplateStep = 1 | 2 | 3;

export const CREATE_TEMPLATE_STEPS: Array<{ step: CreateTemplateStep; label: string }> = [
  { step: 1, label: '營運時段' },
  { step: 2, label: '任務排班' },
  { step: 3, label: '整體預覽' },
];

export const TIME_TEMPLATE_TITLE_LABEL = '時間模板標題:';
export const TIME_TEMPLATE_TITLE_PLACEHOLDER = '在此輸入文字';
export const TIME_TEMPLATE_PREVIEW_TITLE = '時間模板預覽';
/** DB 儲存用；標題可重複，非主鍵 */
export const TIME_TEMPLATE_UNTITLED_NAME = '未完成的時間模板';

export function resolveTimeTemplateDraftName(name: string): string {
  const trimmed = name.trim();
  return trimmed || TIME_TEMPLATE_UNTITLED_NAME;
}

/** 從 DB 載入後還原編輯器輸入（預設名稱顯示為空白） */
export function displayTimeTemplateDraftName(storedName: string): string {
  const trimmed = storedName.trim();
  if (!trimmed || trimmed === TIME_TEMPLATE_UNTITLED_NAME) return '';
  return trimmed;
}

export function emptyEditorDraft(name = ''): TimeTemplateEditorDraft {
  return {
    name,
    vehicleCapacity: VEHICLE_CAPACITY_DEFAULT,
    attributes: [],
    intervals: [],
    tasks: [],
    scheduleRowCount: SCHEDULE_ROW_COUNT_INITIAL,
  };
}

export function isCreateTemplateStep1Complete(draft: TimeTemplateEditorDraft): boolean {
  const hasTitle = draft.name.trim().length > 0;
  const hasDraftAttribute = draft.attributes.some((attr) => attr.isDraft);
  const confirmedIntervals = draft.intervals.filter((slot) => !slot.isDraft);
  return (
    hasTitle
    && !hasDraftAttribute
    && confirmedIntervals.length > 0
    && confirmedIntervals.every((slot) => (
      isValidIntervalRange(slot.startTime, slot.endTime)
      && slot.attributeId.length > 0
      && slot.name.trim().length > 0
    ))
  );
}

/** 任務排班完成：營運時段內每一列都沒有可放任務的時間缺漏。 */
export function isCreateTemplateStep2Complete(draft: TimeTemplateEditorDraft): boolean {
  const confirmedIntervals = draft.intervals.filter((slot) => !slot.isDraft);
  const activeRanges = parseIntervalMinuteRanges(confirmedIntervals);
  if (activeRanges.length === 0) return false;
  return listScheduleTimeGaps(draft.scheduleRowCount, draft.tasks, activeRanges).length === 0;
}

export function isCreateTemplateStepComplete(
  step: CreateTemplateStep,
  draft: TimeTemplateEditorDraft,
): boolean {
  if (step === 1) return isCreateTemplateStep1Complete(draft);
  if (step === 2) return isCreateTemplateStep2Complete(draft);
  return true;
}

/** 步驟是否可點選／進入（整體預覽需任務排班已無缺漏）。 */
export function isCreateTemplateStepUnlocked(
  step: CreateTemplateStep,
  maxReachedStep: CreateTemplateStep,
  draft: TimeTemplateEditorDraft,
): boolean {
  if (step > maxReachedStep) return false;
  if (step >= 3 && !isCreateTemplateStep2Complete(draft)) return false;
  return true;
}

export function serializeEditorDraftBody(draft: TimeTemplateEditorDraft): Record<string, unknown> {
  const vehicleCapacity = Number.isFinite(draft.vehicleCapacity) && draft.vehicleCapacity > 0
    ? Math.round(draft.vehicleCapacity)
    : VEHICLE_CAPACITY_DEFAULT;
  return {
    editorVersion: 1,
    vehicleCapacity,
    attributes: draft.attributes.map((attr) => ({
      ...attr,
      // 寫回時以目前載運量重算，避免舊資料 pphpd 與載運量脫鉤
      capacityPphpd: computeCapacityPphpd(vehicleCapacity, attr.headwaySeconds),
    })),
    intervals: draft.intervals,
    tasks: draft.tasks,
    scheduleRowCount: draft.scheduleRowCount,
  };
}

export type StoredTemplatePreviewData = {
  /** 車體載運量（人／車）；舊模板缺欄時會由屬性 pphpd／班距回推或落回預設 */
  vehicleCapacity: number;
  attributes: TimeSlotAttribute[];
  intervals: TimeSlotInterval[];
  tasks: ScheduleTask[];
  scheduleRowCount: number;
};

/**
 * 自模板 body 解析車體載運量。
 * 優先讀 `vehicleCapacity`；缺漏時依屬性 capacityPphpd × headway 反推；再不行用預設。
 */
export function resolveVehicleCapacityFromBody(
  body: Record<string, unknown>,
  attributes: TimeSlotAttribute[] = [],
): number {
  const raw = body.vehicleCapacity;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }

  for (const attr of attributes) {
    if (attr.isDraft) continue;
    const headway = attr.headwaySeconds;
    const pphpd = attr.capacityPphpd;
    if (headway == null || headway <= 0 || !Number.isFinite(pphpd) || pphpd <= 0) continue;
    const inferred = Math.round((pphpd * headway) / 3600);
    if (inferred > 0) return inferred;
  }

  return VEHICLE_CAPACITY_DEFAULT;
}

export function parseStoredTemplateBody(body: Record<string, unknown>): StoredTemplatePreviewData {
  const attributes = Array.isArray(body.attributes)
    ? (body.attributes as TimeSlotAttribute[]).filter((item) => !item.isDraft)
    : [];
  const intervals = Array.isArray(body.intervals)
    ? (body.intervals as TimeSlotInterval[]).filter((item) => !item.isDraft)
    : [];
  const tasksRaw = Array.isArray(body.tasks) ? (body.tasks as ScheduleTask[]) : [];
  const tasks = migrateScheduleTasks(tasksRaw);
  const scheduleRowCount = typeof body.scheduleRowCount === 'number' && body.scheduleRowCount > 0
    ? body.scheduleRowCount
    : SCHEDULE_ROW_COUNT_INITIAL;
  const vehicleCapacity = resolveVehicleCapacityFromBody(body, attributes);

  return { vehicleCapacity, attributes, intervals, tasks, scheduleRowCount };
}

export function buildEditorDraftFromStored(
  name: string,
  body: Record<string, unknown>,
): TimeTemplateEditorDraft {
  const attributes = Array.isArray(body.attributes)
    ? (body.attributes as TimeSlotAttribute[])
    : [];
  const intervals = Array.isArray(body.intervals)
    ? (body.intervals as TimeSlotInterval[])
    : [];
  const tasksRaw = Array.isArray(body.tasks) ? (body.tasks as ScheduleTask[]) : [];
  const tasks = migrateScheduleTasks(tasksRaw);
  const scheduleRowCount = typeof body.scheduleRowCount === 'number' && body.scheduleRowCount > 0
    ? body.scheduleRowCount
    : SCHEDULE_ROW_COUNT_INITIAL;
  const vehicleCapacity = resolveVehicleCapacityFromBody(body, attributes);

  return {
    name: displayTimeTemplateDraftName(name),
    vehicleCapacity,
    attributes,
    intervals,
    tasks,
    scheduleRowCount,
  };
}

export type AttributeIntervalLegend = {
  attributeId: string;
  name: string;
  color: string;
  timeRangesLabel: string;
  headwaySeconds: number | null;
  capacityPphpd: number;
};

/** 時段屬性名稱長度預算：8 個中文或 12 個英文字元（混合按比例計算）。 */
export const ATTRIBUTE_NAME_MAX_UNITS = 12;

function attributeNameCharUnits(char: string): number {
  if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) return 1.5;
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return 1.5;
  return 1;
}

export function measureAttributeNameUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    units += attributeNameCharUnits(char);
  }
  return units;
}

export function isAttributeNameWithinLimit(text: string): boolean {
  return measureAttributeNameUnits(text) <= ATTRIBUTE_NAME_MAX_UNITS;
}

/** 輸入時截斷至名稱長度上限（中文 8 字 / 英文 12 字等效）。 */
export function clampAttributeNameInput(text: string): string {
  let units = 0;
  let result = '';
  for (const char of text) {
    const weight = attributeNameCharUnits(char);
    if (units + weight > ATTRIBUTE_NAME_MAX_UNITS) break;
    result += char;
    units += weight;
  }
  return result;
}

export const ATTRIBUTE_NAME_LIMIT_HINT =
  '時段屬性名稱最多 8 個中文或 12 個英文字元';

/** 時段屬性標籤：`名稱 | 班距 | 運能` */
export function formatAttributeLegendBadgeText(item: AttributeIntervalLegend): string {
  const headway =
    item.headwaySeconds != null && item.headwaySeconds > 0
      ? `${item.headwaySeconds}秒`
      : '—';
  const capacity =
    item.capacityPphpd > 0
      ? `${item.capacityPphpd.toLocaleString('en-US')}pphpd`
      : '—';
  return `${item.name} | ${headway} | ${capacity}`;
}

export function formatAttributeLegendBadgeTitle(item: AttributeIntervalLegend): string {
  const ranges = item.timeRangesLabel.trim();
  return ranges ? `${item.name}（${ranges}）` : item.name;
}

/** Group Step 1 intervals by attribute for Step 3 legend badges. */
export function buildAttributeIntervalLegends(
  intervals: TimeSlotInterval[],
  attributes: TimeSlotAttribute[],
): AttributeIntervalLegend[] {
  const byAttribute = new Map<string, TimeSlotInterval[]>();
  for (const slot of intervals) {
    if (slot.isDraft) continue;
    const list = byAttribute.get(slot.attributeId) ?? [];
    list.push(slot);
    byAttribute.set(slot.attributeId, list);
  }

  return attributes
    .filter((attr) => !attr.isDraft && byAttribute.has(attr.id))
    .map((attr) => {
      const slots = byAttribute.get(attr.id)!;
      slots.sort(
        (a, b) =>
          (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0),
      );
      const timeRangesLabel = slots
        .map((slot) => `${slot.startTime}-${slot.endTime}`)
        .join(' ');
      return {
        attributeId: attr.id,
        name: attr.name,
        color: attr.color,
        timeRangesLabel,
        headwaySeconds: attr.headwaySeconds,
        capacityPphpd: attr.capacityPphpd,
      };
    });
}

/** 營運時段內某分鐘所屬的已確認時段（無則 null）。 */
export function findOperatingIntervalAtMinute(
  minute: number,
  intervals: TimeSlotInterval[],
): TimeSlotInterval | null {
  for (const slot of intervals) {
    if (slot.isDraft) continue;
    const start = parseIntervalStartMinutes(slot.startTime);
    const end = parseIntervalEndMinutes(slot.endTime);
    if (start == null || end == null || end <= start) continue;
    if (minute >= start && minute < end) return slot;
  }
  return null;
}

export function formatSelectedIntervalHoverContent(
  interval: TimeSlotInterval,
  attribute: TimeSlotAttribute | undefined,
  estimatedTripSeconds?: number | null,
): { title: string; lines: string[] } {
  const intervalName = interval.name.trim() || '未命名時段';
  const attributeName = attribute?.name.trim() || '—';
  const lines: string[] = [
    `時間　${interval.startTime} — ${interval.endTime}`,
    `屬性　${attributeName}`,
    `班距　${formatHeadwayLabel(attribute?.headwaySeconds ?? null)}`,
    `運能　${formatCapacityLabel(attribute?.capacityPphpd ?? 0)}`,
  ];
  const headway = attribute?.headwaySeconds;
  const start = parseIntervalStartMinutes(interval.startTime);
  const end = parseIntervalEndMinutes(interval.endTime);
  const intervalDurationSeconds =
    start != null && end != null && end > start ? (end - start) * 60 : null;
  const fleet = recommendFleetRowCount({
    cycleSeconds: estimatedTripSeconds ?? 0,
    headwaySeconds: headway ?? 0,
    intervalDurationSeconds,
  });
  if (fleet) {
    lines.push(
      `建議時間線　${fleet.recommended} 列`
      + (fleet.recommended !== fleet.theoreticalMin
        ? `（理論下限 ${fleet.theoreticalMin}）`
        : ''),
    );
  }
  return { title: intervalName, lines };
}

export function softHighlightRingStyle(color: string): { boxShadow: string } {
  return {
    boxShadow: `inset 0 0 0 1px ${hexToRgba(color, 0.78)}, 0 0 0 1px ${hexToRgba(color, 0.42)}`,
  };
}

/** 時段選取：貫穿時間軸＋甘特列的整欄包覆高亮 */
export function softHighlightColumnStyle(color: string): {
  boxShadow: string;
  backgroundColor: string;
} {
  return {
    boxShadow: `inset 0 0 0 1px ${hexToRgba(color, 0.82)}, inset 0 0 0 2px ${hexToRgba(color, 0.28)}`,
    backgroundColor: hexToRgba(color, 0.09),
  };
}

export function resolveIntervalTrackLayout(
  slot: TimeSlotInterval,
  slotWidthPx: number,
  scheduleSlotMinutes: number,
): { leftPx: number; widthPx: number } | null {
  const start = parseIntervalStartMinutes(slot.startTime);
  const end = parseIntervalEndMinutes(slot.endTime);
  if (start == null || end == null || end <= start) return null;
  return {
    leftPx: (start / scheduleSlotMinutes) * slotWidthPx,
    widthPx: ((end - start) / scheduleSlotMinutes) * slotWidthPx,
  };
}

