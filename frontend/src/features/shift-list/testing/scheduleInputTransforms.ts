/**
 * 排班重播／泛化測試用的輸入變形（只給 scripts/ 與測試用，正式流程不引用）。
 *
 * 每一種變形都附一個「驗證變形本身」的函式：變形完先確認語意沒有被解析器改掉，
 * 再拿去驗證引擎。否則測到的是變形的錯，不是引擎的錯——實錄：
 * - 整體平移直接把任務開始減 90 分，負值被模板解析器截成 0，所有清晨任務擠到 00:00。
 * - 改名把列舉欄位 type: "DockingPoint" 也改成「改名DockingPoint」，停靠點從 Area 裡消失。
 */
import type { GenerateShiftScheduleInput } from '../utils/schedule-engine/generate';
import { buildThroughVerificationFingerprint } from '../utils/routeRelationThroughCycles';
import {
  parseStoredTemplateBody,
  resolveIntervalMinuteRanges,
  SCHEDULE_DAY_MINUTES,
} from '../../time-templates/types/editor';

type Input = GenerateShiftScheduleInput;

type StoredTask = { id: string; startMinute: number; durationMinutes: number; templateStartMinute?: number };
type StoredInterval = { id: string; startTime: string; endTime: string };
type StoredTemplate = { tasks: StoredTask[]; intervals: StoredInterval[] };

const template = (input: Input) => input.templateBody as unknown as StoredTemplate;

/** 分鐘繞回日循環 [0, 1440) */
export function wrapDayMinute(minute: number): number {
  return ((minute % SCHEDULE_DAY_MINUTES) + SCHEDULE_DAY_MINUTES) % SCHEDULE_DAY_MINUTES;
}

/** HH:mm 平移；結果一律在 00:00–23:59（時段結束的 00:00 由解析器解讀成一天結束） */
export function shiftClock(text: string, minutes: number): string {
  const [hh, mm] = text.split(':').map(Number);
  const total = wrapDayMinute((hh ?? 0) * 60 + (mm ?? 0) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 整體平移：每個任務的開始時刻與每個時段的起訖一起挪 delta 分鐘，持續時間不變。
 * 開始時刻繞回日循環（跨午夜的任務維持跨午夜），不產生負數。
 * 全天時段（起＝訖）平移後仍是起＝訖，語意不變。
 */
export function shiftScheduleInputMinutes(input: Input, delta: number): Input {
  const next = structuredClone(input);
  const body = template(next);
  for (const task of body.tasks) {
    task.startMinute = wrapDayMinute(task.startMinute + delta);
    if (task.templateStartMinute != null) task.templateStartMinute = wrapDayMinute(task.templateStartMinute + delta);
  }
  for (const interval of body.intervals) {
    interval.startTime = shiftClock(interval.startTime, delta);
    interval.endTime = shiftClock(interval.endTime, delta);
  }
  return next;
}

/** 一段時間在日循環上覆蓋的分鐘集合的「形狀」：總長與（繞回後的）起點 */
function intervalShape(startTime: string, endTime: string): { start: number; length: number } | null {
  const ranges = resolveIntervalMinuteRanges(startTime, endTime);
  if (ranges.length === 0) return null;
  const length = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (length >= SCHEDULE_DAY_MINUTES) return { start: 0, length };
  // 跨午夜切成兩段時，真正的起點是不從 0 開始的那一段
  const head = ranges.find((range) => range.start > 0) ?? ranges[0]!;
  return { start: head.start, length };
}

/**
 * 驗證平移本身：兩份模板都經過正式的解析器（parseStoredTemplateBody）之後，
 * 任務數、每個任務的持續時間與「循環位置＝原本＋delta」都要成立；時段數、長度與位置也一樣。
 * 回傳問題清單，空陣列＝平移正確。
 */
export function checkShiftedTemplate(original: Input, shifted: Input, delta: number): string[] {
  const problems: string[] = [];
  const before = parseStoredTemplateBody(original.templateBody as Record<string, unknown>);
  const after = parseStoredTemplateBody(shifted.templateBody as Record<string, unknown>);
  if (before.tasks.length !== after.tasks.length) {
    problems.push(`任務數 ${before.tasks.length} → ${after.tasks.length}`);
  }
  const afterById = new Map(after.tasks.map((task) => [task.id, task] as const));
  for (const task of before.tasks) {
    const moved = afterById.get(task.id);
    if (!moved) {
      problems.push(`任務 ${task.id} 不見了`);
      continue;
    }
    if (Math.abs(moved.durationMinutes - task.durationMinutes) > 1e-6) {
      problems.push(`任務 ${task.id} 持續時間 ${task.durationMinutes} → ${moved.durationMinutes} 分`);
    }
    const expected = wrapDayMinute(task.startMinute + delta);
    if (Math.abs(wrapDayMinute(moved.startMinute) - expected) > 1e-6) {
      problems.push(`任務 ${task.id} 開始 ${task.startMinute} → ${moved.startMinute}（應為 ${expected}）`);
    }
  }
  if (before.intervals.length !== after.intervals.length) {
    problems.push(`時段數 ${before.intervals.length} → ${after.intervals.length}`);
  }
  const intervalsAfter = new Map(after.intervals.map((interval) => [interval.id, interval] as const));
  for (const interval of before.intervals) {
    const moved = intervalsAfter.get(interval.id);
    const shapeBefore = intervalShape(interval.startTime, interval.endTime);
    const shapeAfter = moved ? intervalShape(moved.startTime, moved.endTime) : null;
    if (!shapeBefore || !shapeAfter) {
      problems.push(`時段 ${interval.id} 無法解析`);
      continue;
    }
    if (shapeBefore.length !== shapeAfter.length) {
      problems.push(`時段 ${interval.id} 長度 ${shapeBefore.length} → ${shapeAfter.length} 分`);
    }
    if (shapeBefore.length < SCHEDULE_DAY_MINUTES && wrapDayMinute(shapeBefore.start + delta) !== shapeAfter.start) {
      problems.push(`時段 ${interval.id} 起點 ${shapeBefore.start} → ${shapeAfter.start}`);
    }
  }
  return problems;
}

// ───────────────────────── 改名 ─────────────────────────

const ID_KEY = /(^id$|Id$|Ids$|^from$|^to$|NodeId|StationId|InstanceId)/;
/** 拓樸／軌道接點裡指向節點的欄位（名字不帶 Id） */
const REF_KEY = /^(start|end|waypointCode|rt|rb|lb|lt|up|down|stationIds)$/;
const COMPOSITE_KEY = /(id$|Id$|Ids$|Fingerprint$|Key$|key$)/;
/** 組合 id 的分隔字元（見 routeRelationThroughCycles.ts 的路線組合 id） */
const COMPOSITE_SEPARATOR = '>';
/**
 * 列舉值欄位：值是程式認得的固定字，不是使用者取的名字。即使剛好跟某個名字同字
 * （地圖上真的有物件就叫「DockingPoint」），也絕對不能改。
 */
export const ENUM_KEY = /^(type|kind|taskType|source|dwellMode|mode|status|role|direction|shape)$/;
/** 使用者取的名字本身 */
const NAME_KEY = /^(name|customName|label|labels|stationName|routeName|routeCode|cardLabel|groupName|serviceDirectionName|templateName|taskName|startStationName|endStationName)$/;
/**
 * 以名字引用別的物件的欄位（整備清單用代號對設施、卡片記下經過的節點名稱…）。
 * 改名只作用在這些明確的名稱欄位與識別碼參照上，其他欄位的字串一律不動。
 */
const NAME_REF_KEY = /(Name|Label|Labels)$|^(alias|mapCode)$/;
/** 值是名稱代號的物件（例如各整備區段的代號表） */
const NAME_VALUE_PARENT = /^(sectionCodeBySection|maintenanceSectionCodeBySection)$/;

function renameMap(values: Iterable<string>, mode: 'prefix' | 'opaque', prefix: string): Map<string, string> {
  const unique = [...new Set(values)].filter((value) => value.length > 0);
  if (mode === 'prefix') return new Map(unique.map((value) => [value, `${prefix}${value}`]));
  // 反序編號：刻意打亂原本的排序關係
  const sorted = unique.sort().reverse();
  return new Map(sorted.map((value, index) => [value, `${prefix}${String(index).padStart(5, '0')}`]));
}

function collect(value: unknown, key: string, ids: Set<string>, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, key, ids, names);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) collect(child, childKey, ids, names);
    return;
  }
  if (typeof value !== 'string') return;
  /**
   * 由別的識別碼串成的組合 id（路線組合「起點站>路線…>終點站」）不是獨立的識別碼：引擎每次用
   * 目前的 id 重新串一次再比對。整串換成一個代號，改名後就對不上、默默改用別的組合——
   * 那是測試工具造成的差異，不是引擎依名稱做決策。組合 id 交給下面的逐段替換（COMPOSITE_KEY）。
   */
  if (value.includes(COMPOSITE_SEPARATOR)) return;
  if (ID_KEY.test(key) || key === 'stationIds') ids.add(value);
  if (NAME_KEY.test(key)) names.add(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 改名表。
 * - prefix：每個名字前面加同一段前綴。任何比較方式下相對順序都不變，結果必須與基準完全等價。
 * - opaque：換成與原名無關的代號，排序關係會變；只檢查不變量。
 * - displayOnly：只改顯示名稱，識別碼不動。
 */
export function renameScheduleInput(
  input: Input,
  mode: 'prefix' | 'opaque',
  displayOnly = false,
): { input: Input; rename: (value: unknown) => unknown } {
  const ids = new Set<string>();
  const names = new Set<string>();
  // 上次的產出不是這次的輸入，不收它的名字
  const draftRest = { ...input.draft } as Record<string, unknown>;
  delete draftRest.scheduleOutput;
  collect({ ...input, draft: draftRest }, '', ids, names);
  if (!displayOnly) for (const id of ids) names.delete(id);
  const idMap = renameMap(displayOnly ? [] : ids, mode, 'x_');
  const nameMap = renameMap(names, mode, '改名');
  const idPattern = idMap.size > 0
    ? new RegExp(`(?<![A-Za-z0-9_])(${[...idMap.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![A-Za-z0-9_])`, 'g')
    : null;
  const renameString = (text: string, key: string, parentKey: string): string => {
    if (ENUM_KEY.test(key)) return text;
    const nameField = NAME_KEY.test(key) || NAME_REF_KEY.test(key) || NAME_VALUE_PARENT.test(parentKey);
    if (displayOnly) return nameField ? nameMap.get(text) ?? text : text;
    // 純數字的識別碼（設施 "100"）可能跟數值欄位（充電上限 "100"）撞字面：只在參照欄位換
    if (idMap.has(text) && (!/^\d+$/.test(text) || ID_KEY.test(key) || REF_KEY.test(key))) return idMap.get(text)!;
    if (nameField && nameMap.has(text)) return nameMap.get(text)!;
    if (idPattern && COMPOSITE_KEY.test(key)) return text.replace(idPattern, (match) => idMap.get(match) ?? match);
    return text;
  };
  const rename = (value: unknown, key = '', parentKey = ''): unknown => {
    if (Array.isArray(value)) return value.map((item) => rename(item, key, parentKey));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [idMap.get(childKey) ?? childKey, rename(child, childKey, key)]),
      );
    }
    return typeof value === 'string' ? renameString(value, key, parentKey) : value;
  };
  return { input: rename(input) as Input, rename: (value) => rename(value) };
}

/** 列出兩份資料中列舉欄位（ENUM_KEY）不同的地方；改名後必須是空的 */
export function enumFieldChanges(before: unknown, after: unknown, path = ''): string[] {
  if (Array.isArray(before)) {
    const list = Array.isArray(after) ? after : [];
    return before.flatMap((item, index) => enumFieldChanges(item, list[index], `${path}[${index}]`));
  }
  if (before && typeof before === 'object') {
    const target = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
    // 物件的鍵本身可能是識別碼（會被改名），按順序對應
    const afterValues = Object.values(target);
    return Object.entries(before).flatMap(([key, value], index) => {
      if (ENUM_KEY.test(key) && typeof value === 'string') {
        const next = target[key];
        return next === value ? [] : [`${path}.${key}: ${value} → ${String(next)}`];
      }
      return enumFieldChanges(value, afterValues[index], `${path}.${key}`);
    });
  }
  return [];
}

/**
 * 改了識別碼之後，產品要求使用者回 Step 4 重新驗證交路（指紋對不上就停止排班）。
 * 測試模擬「使用者重新驗證」：用同一個指紋函式重算；不改任何排班參數。
 */
export function reverifyThroughFingerprint(input: Input): Input {
  const groups = input.draft.routeGroups;
  const anchors = groups.throughAnchors;
  if (!anchors?.verifiedFingerprint || !groups.routeRelationGraph) return input;
  const routeMode = anchors.startInstanceIds.length > 0 || anchors.endInstanceIds.length > 0;
  const fingerprint = buildThroughVerificationFingerprint({
    startStationIds: routeMode ? [] : anchors.startStationIds,
    endStationIds: routeMode ? [] : anchors.endStationIds,
    startInstanceIds: anchors.startInstanceIds,
    endInstanceIds: anchors.endInstanceIds,
    routes: groups.selectedRoutes,
    graph: groups.routeRelationGraph,
    minimumRecoveryTimeSeconds: groups.minimumRecoveryTimeSeconds,
  });
  anchors.verifiedFingerprint = fingerprint;
  if ('listedFingerprint' in anchors) (anchors as { listedFingerprint?: string }).listedFingerprint = fingerprint;
  return input;
}
