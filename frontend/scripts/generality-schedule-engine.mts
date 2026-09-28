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
 *   但必須通過安全檢查；有碰撞或安全間隔不足，即使報告列出也算失敗。
 *   另檢查卡片身分、原始設定不變，以及前後端逐站時刻一致。
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
import { extractFacilityMapCodes } from '../src/features/shift-list/utils/maintenanceFirstTripOrigins';
import { nodeMatchesMoveCardCodes } from '../src/features/shift-list/utils/moveCardShared';
import {
  checkShiftedTemplate,
  renameScheduleInput,
  reverifyThroughFingerprint,
  shiftClock,
  shiftScheduleInputMinutes,
} from '../src/features/shift-list/testing/scheduleInputTransforms';

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
  const originalInput = JSON.stringify(input);
  const result = generateShiftSchedule(input);
  if (JSON.stringify(input) !== originalInput) throw new Error('生成引擎改動了原始輸入參數');
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
  const blocking = allIssues(result).filter((issue) => issue.severity === 'error' || PUBLISH_BLOCKING_CODES.has(issue.code));
  if (blocking.length > 0) failures.push(`安全驗收失敗：${blocking.length} 筆阻擋發布的問題`);
  if (!result.report.ok) failures.push('生成結果未通過驗收');
  const routes = input.draft.routeGroups.selectedRoutes;
  const parkingCodes = extractFacilityMapCodes(input.maintenanceTaskBody, 'mobile');
  const allowedParking = new Set((input.pointTopology?.nodes ?? [])
    .filter((node) => ['facility', 'docking', 'facility-docking'].includes(node.kind)
      && nodeMatchesMoveCardCodes(node, parkingCodes)).map((node) => node.id));
  for (const block of plan.timelines.flatMap((timeline) => timeline.blocks)) {
    if (block.id.startsWith('berthpark-') && block.taskType === 'idle'
      && !allowedParking.has(block.yardFacilityNodeId ?? '')) {
      failures.push(`${block.id} 借用了待命清單以外的位置`);
    }
  }

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
  if (recheck.blockingIssues.length > 0) failures.push(`獨立安全檢查失敗：${recheck.blockingIssues.length} 筆問題`);
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

// 改名、平移等變形與「驗證變形本身」放在共用模組（有自己的測試），這裡只引用
const renameInput = renameScheduleInput;

type TemplateBody = {
  tasks: Array<{ rowIndex: number; startMinute: number; durationMinutes: number; taskType: string }>;
  intervals: Array<{ startTime: string; endTime: string; attributeId: string }>;
  attributes: Array<{ id: string; headwaySeconds: number }>;
  scheduleRowCount: number;
};
const template = (input: Input) => input.templateBody as unknown as TemplateBody;

function shiftTime(input: Input, minutes: number): Input {
  const next = shiftScheduleInputMinutes(input, minutes);
  const problems = checkShiftedTemplate(input, next, minutes);
  if (problems.length > 0) throw new Error(`平移變形本身不正確（不是引擎問題）：${problems.slice(0, 5).join('；')}`);
  return next;
}

const reverify = reverifyThroughFingerprint;

const variants: Array<{
  name: string;
  kind: 'equivalent' | 'changed';
  build: (input: Input) => Input;
}> = [
  { name: 'rerun', kind: 'equivalent', build: clone },
  { name: 'label-rename', kind: 'equivalent', build: (input) => renameInput(input, 'prefix', true).input },
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
  const input = variant.kind === 'changed' || variant.name.includes('rename') ? reverify(built) : built;
  const { result, elapsedMs } = run(input);
  const variantMetrics = metrics(result);
  const failures = invariants(input, result);
  if (dumpDir) {
    writeFileSync(`${dumpDir}/${variant.name}.json`, JSON.stringify(result));
    writeFileSync(`${dumpDir}/${variant.name}-input.json`, JSON.stringify(input));
  }
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
  if (flag('out')) writeFileSync(flag('out')!, JSON.stringify(report, null, 2));
  console.error(`[${variant.name}] ${elapsedMs}ms 不變量失敗 ${failures.length}${equivalence.length ? `，等價失敗 ${equivalence.length}` : ''}`);
}

console.log(JSON.stringify(report, null, 2));
const outPath = flag('out');
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
