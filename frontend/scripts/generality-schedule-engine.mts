#!/usr/bin/env -S npx tsx
/**
 * 排班引擎泛用性檢查：拿一份真實輸入 log，做「換名字／整體平移／改參數」等變形後各跑一次，
 * 檢查結果是不是只由輸入條件決定、而不是認得某個名稱或時刻。
 *
 * 用法：
 *   npx tsx scripts/generality-schedule-engine.mts <engine-input.json> [--only a,b] [--out result.json]
 *
 * 兩類檢查：
 * - 等價變形（改名、整體平移、重跑、從上次輸出再生成）：結果要與基準等價
 *   （改名：把基準結果套同一張改名表後指紋相同；平移：所有時刻差固定值、數量相同）。
 * - 改條件（班距、時段邊界、行駛時間、車數、設施、緩衝、搜尋預算）：不要求結果一樣，
 *   但必須守住不變量——獨立重驗證找得到的問題報告裡都有（不假裝可行）、殘留站位衝突都標
 *   「目前未找到」、卡片身分不重複、系統緩衝只加不改原始設定、前後端逐站時刻一致。
 *
 * 不經過任何會存檔／部署班表的入口。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { GenerateShiftScheduleInput } from '../src/features/shift-list/utils/schedule-engine/generate';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
} from '../src/features/shift-list/utils/schedule-engine/types';
import { PUBLISH_BLOCKING_CODES } from '../src/features/shift-list/utils/scheduleAcceptance';
import {
  buildPlanFingerprint,
  runSchedulePublishCheck,
} from '../src/features/shift-list/utils/schedulePublishCheck';
import {
  buildBlockStationDepartures,
  resolveBlockDwellSlackBreakdown,
  resolveRouteForBlock,
} from '../src/features/shift-list/utils/buildBlockStationDepartures';
import { buildTimetableStationStops } from '../../backend/src/operation-shift/timetable/build-station-stops';
import { buildThroughVerificationFingerprint } from '../src/features/shift-list/utils/routeRelationThroughCycles';

type Input = GenerateShiftScheduleInput;
type Result = ReturnType<typeof generateShiftSchedule>;

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'));
const flag = (name: string): string | null => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? null : null;
};
if (!inputPath) {
  console.error('用法：npx tsx scripts/generality-schedule-engine.mts <engine-input.json> [--only a,b] [--out result.json]');
  process.exit(1);
}
const only = flag('only')?.split(',') ?? null;
/** 另存每個變形的 plan 與報告（除錯用，比對第一個分歧點） */
const dumpDir = flag('dump');

const original = JSON.parse(readFileSync(inputPath, 'utf-8')) as Input;
const clone = <T,>(value: T): T => structuredClone(value);

// ───────────────────────── 執行與量測 ─────────────────────────

function run(input: Input): { result: Result; elapsedMs: number } {
  const startedAt = Date.now();
  const result = generateShiftSchedule(input);
  return { result, elapsedMs: Date.now() - startedAt };
}

function allIssues(result: Result): FeasibilityIssue[] {
  return [...result.report.errors, ...result.report.warnings];
}

function metrics(result: Result) {
  const issues = allIssues(result);
  const count = (code: string) => issues.filter((issue) => issue.code === code).length;
  let passengerTrips = 0;
  let slackBlocks = 0;
  let maintenanceBlocks = 0;
  for (const timeline of result.plan?.timelines ?? []) {
    for (const block of timeline.blocks) {
      if (block.taskType === 'passenger') passengerTrips += 1;
      if (block.dwellSlackAdjustment) slackBlocks += 1;
      if (block.source !== 'hold' && ['charging', 'servicing', 'inspection', 'washing'].includes(block.taskType)) {
        maintenanceBlocks += 1;
      }
    }
  }
  const blocking: Record<string, number> = {};
  for (const issue of issues) {
    if (PUBLISH_BLOCKING_CODES.has(issue.code) || issue.severity === 'error') {
      blocking[issue.code] = (blocking[issue.code] ?? 0) + 1;
    }
  }
  return {
    passengerTrips,
    slackBlocks,
    maintenanceBlocks,
    unservedPulses: count('UNSERVED_SERVICE_PULSE'),
    headwayBelowTarget: count('HEADWAY_BELOW_TARGET'),
    blocking: Object.fromEntries(Object.entries(blocking).sort()),
  };
}

// ───────────────────────── 不變量 ─────────────────────────

function invariants(input: Input, result: Result): string[] {
  const failures: string[] = [];
  const plan = result.plan;
  if (!plan) return ['沒有產出 plan'];
  const routes = input.draft.routeGroups.selectedRoutes;

  // 1. 卡片身分不重複（重跑／聯動不重複插卡）
  const seen = new Set<string>();
  for (const timeline of plan.timelines) {
    for (const block of timeline.blocks) {
      if (seen.has(block.id)) failures.push(`卡片身分重複：${block.id}`);
      seen.add(block.id);
    }
  }

  // 2. 不假裝可行：獨立重驗證找到的擋發布問題，報告裡要一筆不少
  const recheck = runSchedulePublishCheck({
    plan,
    selectedRoutes: routes,
    collisionProtectionSeconds: input.draft.routeGroups.collisionProtectionSeconds ?? 0,
    topology: input.pointTopology,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
  });
  const reported: Record<string, number> = {};
  for (const issue of allIssues(result)) reported[issue.code] = (reported[issue.code] ?? 0) + 1;
  // 缺移動的那一列若已報「必要轉場排不出」，就是同一件事換個說法（報告合併成一筆），不算漏報
  const transferMissingRows = new Set(
    allIssues(result)
      .filter((issue) => issue.code === 'MAINTENANCE_TRANSFER_REQUIRED_MISSING')
      .map((issue) => (issue.detail as { timelineRow?: number } | undefined)?.timelineRow),
  );
  const recheckByCode: Record<string, number> = {};
  for (const issue of recheck.blockingIssues) {
    const row = (issue.detail as { timelineRow?: number } | undefined)?.timelineRow;
    if (issue.code === 'VEHICLE_LOCATION_DISCONTINUITY' && transferMissingRows.has(row)) continue;
    recheckByCode[issue.code] = (recheckByCode[issue.code] ?? 0) + 1;
  }
  for (const [code, count] of Object.entries(recheckByCode)) {
    if ((reported[code] ?? 0) < count) {
      failures.push(`重驗證找到 ${code}×${count}，報告只有 ${reported[code] ?? 0}`);
    }
  }

  // 3. 殘留站位衝突要說清楚是「目前未找到」，不能沒交代
  for (const issue of allIssues(result)) {
    if (issue.code !== 'STATION_BERTH_COLLISION' && issue.code !== 'STATION_BERTH_PROTECTION_GAP') continue;
    const status = (issue.detail as { resolutionStatus?: string } | undefined)?.resolutionStatus;
    if (status !== 'not_found') failures.push(`殘留 ${issue.code} 沒標搜尋結果：${issue.message.split('\n')[0]}`);
  }

  // 4. 系統緩衝只加：原始緩衝欄位不被改寫、增加量為正、基本停靠不變；前後端逐站一致
  let stopMismatch = 0;
  for (const timeline of plan.timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      const route = resolveRouteForBlock(block, routes);
      if (!route) continue;
      const adjustment = block.dwellSlackAdjustment;
      if (adjustment) {
        const breakdown = resolveBlockDwellSlackBreakdown(block, route);
        if (!(adjustment.addedSeconds > 0)) failures.push(`${block.id} 增加量不為正：${adjustment.addedSeconds}`);
        if (breakdown.baseSlackSeconds !== adjustment.baseSlackSeconds) {
          failures.push(`${block.id} 原始緩衝被改：紀錄 ${adjustment.baseSlackSeconds}，現在 ${breakdown.baseSlackSeconds}`);
        }
        if (adjustment.affectedStops.length === 0) failures.push(`${block.id} 緩衝調整沒有受影響站點`);
      }
      const front = buildBlockStationDepartures(block, route);
      const baseByStation = new Map(
        (block.stationDwells ?? route.stationDwells ?? []).map((dwell) => [dwell.stationId, dwell.dwellSeconds ?? 0]),
      );
      for (const stop of front) {
        const configured = baseByStation.get(stop.stationId);
        if (configured != null && stop.baseDwellSeconds > configured) {
          failures.push(`${block.id} ${stop.stationName} 基本停靠 ${stop.baseDwellSeconds} 超過設定 ${configured}`);
        }
      }
      const back = buildTimetableStationStops(block as never, route as never);
      const frontKey = front.map((stop) =>
        `${stop.stationId}:${Math.round(stop.arrivalMinute * 60)}:${Math.round(stop.departureMinute * 60)}`).join(',');
      const backKey = back.map((stop) => `${stop.stationId}:${stop.arrivalSecond}:${stop.departureSecond}`).join(',');
      if (frontKey !== backKey) stopMismatch += 1;
    }
  }
  if (stopMismatch > 0) failures.push(`前後端逐站時刻不一致 ${stopMismatch} 趟`);

  // 5. 保存／重開：JSON 來回後指紋不變、緩衝紀錄還在
  const reopened = JSON.parse(JSON.stringify(plan)) as GeneratedSchedulePlan;
  if (buildPlanFingerprint(reopened) !== buildPlanFingerprint(plan)) failures.push('JSON 來回後 plan 指紋改變');
  return failures;
}

// ───────────────────────── 變形 ─────────────────────────

const ID_KEY = /(^id$|Id$|Ids$|^from$|^to$|NodeId|StationId|InstanceId)/;
/** 拓樸／軌道接點裡指向節點的欄位（名字不帶 Id） */
const REF_KEY = /^(start|end|waypointCode|rt|rb|lb|lt|up|down|stationIds)$/;
const COMPOSITE_KEY = /(id$|Id$|Ids$|Fingerprint$|Key$|key$)/;
const NAME_KEY = /^(name|customName|label|labels|stationName|routeName|routeCode|cardLabel|groupName|serviceDirectionName|templateName|taskName|startStationName|endStationName)$/;

/**
 * 改名表。
 * - prefix：每個名字前面加同一段前綴。任何比較方式（字碼、localeCompare）下相對順序都不變，
 *   所以結果必須與基準<strong>完全等價</strong>；引擎若認得某個名字（例如看開頭字樣）就會露餡。
 * - opaque：換成與原名無關的代號，排序關係會變。引擎在平手時依識別碼決定先後，
 *   這一種只檢查不變量，並揭露結果對平手順序有多敏感。
 */
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
  if (ID_KEY.test(key) || key === 'stationIds') ids.add(value);
  if (NAME_KEY.test(key)) names.add(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renameInput(input: Input, mode: 'prefix' | 'opaque'): { input: Input; rename: (value: unknown) => unknown } {
  const ids = new Set<string>();
  const names = new Set<string>();
  // 上次的產出不是這次的輸入，不收它的名字
  const { scheduleOutput: _omit, ...draftRest } = input.draft as Input['draft'] & { scheduleOutput?: unknown };
  collect({ ...input, draft: draftRest }, '', ids, names);
  for (const id of ids) names.delete(id);
  const idMap = renameMap(ids, mode, 'x_');
  const nameMap = renameMap(names, mode, '改名');
  const idPattern = idMap.size > 0
    ? new RegExp(`(?<![A-Za-z0-9_])(${[...idMap.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![A-Za-z0-9_])`, 'g')
    : null;
  const renameString = (text: string, key: string): string => {
    // 純數字的識別碼（設施 "100"）可能跟數值欄位（充電上限 "100"）撞字面：只在參照欄位換
    if (idMap.has(text) && (!/^\d+$/.test(text) || ID_KEY.test(key) || REF_KEY.test(key))) return idMap.get(text)!;
    if (nameMap.has(text)) return nameMap.get(text)!;
    if (idPattern && COMPOSITE_KEY.test(key)) return text.replace(idPattern, (match) => idMap.get(match) ?? match);
    return text;
  };
  const rename = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map((item) => rename(item, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [idMap.get(childKey) ?? childKey, rename(child, childKey)]),
      );
    }
    return typeof value === 'string' ? renameString(value, key) : value;
  };
  return { input: rename(input) as Input, rename: (value) => rename(value) };
}

function shiftClock(text: string, minutes: number): string {
  const [h, m] = text.split(':').map(Number);
  const total = ((h! * 60 + m! + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

type TemplateBody = {
  tasks: Array<{ rowIndex: number; startMinute: number; durationMinutes: number; taskType: string }>;
  intervals: Array<{ startTime: string; endTime: string; attributeId: string }>;
  attributes: Array<{ id: string; headwaySeconds: number }>;
  scheduleRowCount: number;
};
const template = (input: Input) => input.templateBody as unknown as TemplateBody;

function shiftTime(input: Input, minutes: number): Input {
  const next = clone(input);
  for (const task of template(next).tasks) task.startMinute += minutes;
  for (const interval of template(next).intervals) {
    interval.startTime = shiftClock(interval.startTime, minutes);
    interval.endTime = shiftClock(interval.endTime, minutes);
  }
  return next;
}

/**
 * 改了路線參數，產品要求使用者回 Step 4 重新驗證交路（指紋對不上就停止排班）。
 * 測試模擬「使用者重新驗證」：用同一個指紋函式重算；不改任何排班參數。
 */
function reverify(input: Input): Input {
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

const variants: Array<{
  name: string;
  kind: 'equivalent' | 'changed';
  build: (input: Input) => Input;
}> = [
  { name: 'rerun', kind: 'equivalent', build: clone },
  /**
   * 真實資料改名不要求逐卡等價：引擎在平手時用識別碼／設施名稱決定先後（確定性的次序，
   * 不是認得某個名字），而改名會讓「使用者給的名字」和「引擎產生的識別碼」之間的先後
   * 對調（例：x_task… 排到 template-pax… 後面），平手的挑法就不同。只檢查不變量並揭露
   * 結果差異。嚴格的改名等價測在單元測試（全部名字一起換、不混用）。
   */
  { name: 'rename', kind: 'changed', build: (input) => renameInput(input, 'prefix').input },
  { name: 'rename-opaque', kind: 'changed', build: (input) => renameInput(input, 'opaque').input },
  // 整天循環的模板平移後，跨午夜那一段會繞回清晨（23:30–00:30 同時蓋住 00:00–00:30），
  // 不是嚴格等價的輸入；只檢查不變量。嚴格的平移等價測在單元測試（非整天模板）。
  { name: 'shift+30m', kind: 'changed', build: (input) => shiftTime(input, 30) },
  {
    name: 'headway',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      // 最密的時段放寬 20 秒、最疏的時段收緊 60 秒：兩個方向都要測
      const attributes = [...template(next).attributes].sort((a, b) => a.headwaySeconds - b.headwaySeconds);
      attributes[0]!.headwaySeconds += 20;
      attributes[attributes.length - 1]!.headwaySeconds -= 60;
      return next;
    },
  },
  {
    name: 'peak-boundary',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      // 每個時段邊界都往後挪 30 分鐘（頭尾不動），時段長度跟著變
      const intervals = template(next).intervals;
      const boundaries = new Set(intervals.map((interval) => interval.startTime));
      for (const interval of intervals) {
        if (interval.startTime !== '00:00' && boundaries.has(interval.startTime)) {
          interval.startTime = shiftClock(interval.startTime, 30);
        }
        if (interval.endTime !== '00:00' && boundaries.has(interval.endTime)) {
          interval.endTime = shiftClock(interval.endTime, 30);
        }
      }
      return next;
    },
  },
  {
    name: 'travel+15s',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      for (const route of next.draft.routeGroups.selectedRoutes) {
        route.avgTravelTimeSeconds = (route.avgTravelTimeSeconds ?? 0) + 15;
        route.minTravelTimeSeconds = (route.minTravelTimeSeconds ?? 0) + 10;
        const legs = route.stationLegTravels ?? [];
        for (const leg of legs) {
          leg.avgTravelTimeSeconds = (leg.avgTravelTimeSeconds ?? 0) + Math.round(15 / Math.max(1, legs.length));
          leg.minTravelTimeSeconds = (leg.minTravelTimeSeconds ?? 0) + Math.round(10 / Math.max(1, legs.length));
        }
      }
      return next;
    },
  },
  {
    name: 'rows-1',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      const body = template(next);
      const last = body.scheduleRowCount;
      body.tasks = body.tasks.filter((task) => task.rowIndex !== last);
      body.scheduleRowCount = last - 1;
      return next;
    },
  },
  {
    name: 'first-facility-removed',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      // 每種整備的第一台設備拿掉：原本最先被挑的那格不可用，要換下一個候選
      const body = next.maintenanceTaskBody as Record<string, { equipmentRows?: unknown[] }> | null | undefined;
      for (const section of Object.values(body ?? {})) {
        if (section && typeof section === 'object' && Array.isArray(section.equipmentRows) && section.equipmentRows.length > 1) {
          section.equipmentRows = section.equipmentRows.slice(1);
        }
      }
      return next;
    },
  },
  {
    name: 'slack+6s',
    kind: 'changed',
    build: (input) => {
      const next = clone(input);
      for (const route of next.draft.routeGroups.selectedRoutes) {
        route.dwellSlackSeconds = (route.dwellSlackSeconds ?? 0) + 6;
      }
      return next;
    },
  },
  {
    name: 'budget-tiny',
    kind: 'changed',
    build: (input) => ({ ...clone(input), residualRepairBudget: { maxEvaluations: 3, maxDepth: 1 } }),
  },
];

// ───────────────────────── 比較 ─────────────────────────

function departures(plan: GeneratedSchedulePlan): number[] {
  return plan.timelines
    .flatMap((timeline) => timeline.blocks)
    .filter((block) => block.taskType === 'passenger')
    .map((block) => Math.round(block.plannedStartMinute * 60))
    .sort((a, b) => a - b);
}

const report: Record<string, unknown> = {};
const baseRun = run(original);
const baseMetrics = metrics(baseRun.result);
const baseFailures = invariants(original, baseRun.result);
if (dumpDir) writeFileSync(`${dumpDir}/base.json`, JSON.stringify(baseRun.result));
report.base = { elapsedMs: baseRun.elapsedMs, metrics: baseMetrics, invariantFailures: baseFailures };
console.error(`[base] ${baseRun.elapsedMs}ms 不變量失敗 ${baseFailures.length}`);

let failed = baseFailures.length > 0;
for (const variant of variants) {
  if (only && !only.includes(variant.name)) continue;
  const built = variant.build(original);
  const input = variant.kind === 'changed' || variant.name.startsWith('rename') ? reverify(built) : built;
  const { result, elapsedMs } = run(input);
  const variantMetrics = metrics(result);
  const failures = invariants(input, result);
  if (dumpDir) writeFileSync(`${dumpDir}/${variant.name}.json`, JSON.stringify(result));
  const equivalence: string[] = [];
  if (variant.kind === 'equivalent' && result.plan && baseRun.result.plan) {
    if (variant.name === 'rerun') {
      if (buildPlanFingerprint(result.plan) !== buildPlanFingerprint(baseRun.result.plan)) {
        equivalence.push('同一份輸入重跑，plan 指紋不同（不穩定）');
      }
    }
    if (variant.name === 'rename') {
      const { rename } = renameInput(original, 'prefix');
      const expected = rename(baseRun.result.plan) as GeneratedSchedulePlan;
      if (dumpDir) writeFileSync(`${dumpDir}/base-renamed.json`, JSON.stringify({ plan: expected }));
      if (buildPlanFingerprint(expected) !== buildPlanFingerprint(result.plan)) {
        equivalence.push('改名後結果與「基準結果套同一張改名表」不同');
      }
    }
    if (variant.name.startsWith('shift+')) {
      const minutes = Number(variant.name.slice(6, -1));
      const expected = departures(baseRun.result.plan).map((second) => second + minutes * 60);
      const actual = departures(result.plan);
      if (expected.join(',') !== actual.join(',')) {
        const actualSet = new Map<number, number>();
        for (const second of actual) actualSet.set(second, (actualSet.get(second) ?? 0) + 1);
        const missing: number[] = [];
        for (const second of expected) {
          const left = actualSet.get(second) ?? 0;
          if (left > 0) actualSet.set(second, left - 1);
          else missing.push(second);
        }
        const extra = [...actualSet.entries()].flatMap(([second, left]) => Array(left).fill(second) as number[]);
        const hms = (second: number) => new Date(second * 1000).toISOString().slice(11, 19);
        equivalence.push(
          `整體平移後發車時刻不等於基準＋${minutes} 分：少 ${missing.length} 筆（${missing.slice(0, 8).map(hms).join('、')}…），`
          + `多 ${extra.length} 筆（${extra.slice(0, 8).map(hms).join('、')}…）`,
        );
      }
    }
    if (JSON.stringify(variantMetrics) !== JSON.stringify(baseMetrics)) {
      equivalence.push(`量測不同：${JSON.stringify(baseMetrics)} → ${JSON.stringify(variantMetrics)}`);
    }
  }
  if (failures.length > 0 || equivalence.length > 0) failed = true;
  report[variant.name] = { kind: variant.kind, elapsedMs, metrics: variantMetrics, invariantFailures: failures, equivalence };
  console.error(`[${variant.name}] ${elapsedMs}ms 不變量失敗 ${failures.length}${equivalence.length ? `，等價失敗 ${equivalence.length}` : ''}`);
}

console.log(JSON.stringify(report, null, 2));
const outPath = flag('out');
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
