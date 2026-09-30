#!/usr/bin/env -S npx tsx
/**
 * 排班安全重播：<strong>單一案例</strong>的執行者（由 schedule-safety-replay.mts 以子程序啟動）。
 *
 * 父程序負責逾時與終止——生成是同步運算，程序內的 setTimeout 打斷不了它，只能從外面結束。
 * 這支只做一件事：讀規格 → 變形並驗證變形本身 → 生成 → 獨立重驗 → 把證據與分類寫進案例目錄。
 *
 * 案例目錄內容：
 *   spec.json      父程序寫入的案例規格
 *   input.json     實際餵給引擎的輸入（變形後）
 *   result.json    生成結果（班表與完整報告）
 *   issues.json    完整問題清單（不只前幾筆）
 *   recheck.json   獨立安全檢查結果
 *   summary.json   分類與摘要（父程序讀這個）
 *
 * 用法（通常不直接呼叫）：node --import tsx scripts/schedule-safety-replay-case.mts <case-dir>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { GenerateShiftScheduleInput } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { FeasibilityIssue } from '../src/features/shift-list/utils/schedule-engine/types';
import { PUBLISH_BLOCKING_CODES } from '../src/features/shift-list/utils/scheduleAcceptance';
import { listTopologyTravelTimeGaps } from '../src/features/shift-list/utils/findTopologyPath';
import { runSchedulePublishCheck } from '../src/features/shift-list/utils/schedulePublishCheck';
import { checkScheduleInputData } from '../src/features/shift-list/utils/scheduleInputDataCheck';
import {
  checkShiftedTemplate,
  enumFieldChanges,
  renameScheduleInput,
  reverifyThroughFingerprint,
  shiftScheduleInputMinutes,
} from '../src/features/shift-list/testing/scheduleInputTransforms';

type Input = GenerateShiftScheduleInput;
export type ReplayTransform =
  | ReplayInvalidTransform
  | { kind: 'shift-minutes'; minutes: number }
  | { kind: 'rename'; mode: 'prefix' | 'opaque'; displayOnly?: boolean }
  | { kind: 'drop-standby-facility'; index: number }
  | { kind: 'protection-seconds'; seconds: number }
  /**
   * 模板調整假設（白皮書 YARD-06）：某類整備緊接在另一段整備後面時，把兩段的交界往前移 minutes 分鐘，
   * 讓後一段多出放移動的時間（前一段等量變短）。只用來驗證「模板照建議調整後排不排得出」，不是正式資料。
   */
  | { kind: 'widen-yard-boundary'; taskType: string; minutes: number }
  /** 路網長度不同：所有路段與路線的行駛時間乘上 factor（泛用性測試；不是正式資料） */
  | { kind: 'scale-travel'; factor: number };
/** 非法輸入：清掉路線群組選的地圖／拿掉關聯圖（驗證正式入口會擋下） */
export type ReplayInvalidTransform = { kind: 'drop-map-id' } | { kind: 'drop-relation-graph' };
export type ReplayCaseSpec = {
  name: string;
  /** 原始輸入檔（絕對路徑） */
  inputPath: string;
  transforms: ReplayTransform[];
};
export type ReplayOutcome = 'safe' | 'blocked' | 'invalid-input' | 'search-exhausted' | 'timeout' | 'crash';
export type ReplayCaseSummary = {
  name: string;
  outcome: ReplayOutcome;
  /** 班表本身是否安全可發布（跟「測試是否符合預期」是兩件事） */
  publishSafe: boolean;
  sourceSha256: string;
  inputSha256: string | null;
  elapsedMs: number;
  passengerTrips: number;
  blockingByCode: Record<string, number>;
  recheckBlockingByCode: Record<string, number>;
  /** 問題的類別：缺資料、搜尋未完成、衝突… */
  reasons: string[];
  invalidInput?: string[];
  error?: string;
  /** 路網資料檢查：沒填行駛時間的路段、明確填 0 秒的路段（後者只列出來請使用者確認） */
  dataChecks?: { missingTravelTime: string[]; explicitZeroTravelTime: string[] };
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function applyTransform(input: Input, transform: ReplayTransform): { input: Input; problems: string[] } {
  if (transform.kind === 'shift-minutes') {
    const next = shiftScheduleInputMinutes(input, transform.minutes);
    return { input: next, problems: checkShiftedTemplate(input, next, transform.minutes) };
  }
  if (transform.kind === 'rename') {
    const renamed = renameScheduleInput(input, transform.mode, transform.displayOnly).input;
    // 識別碼換了：模擬使用者回 Step 4 重新驗證交路（跟 generality 腳本同一個做法）
    const next = transform.displayOnly ? renamed : reverifyThroughFingerprint(renamed);
    return { input: next, problems: enumFieldChanges(input, next).map((line) => `改名動到列舉欄位 ${line}`) };
  }
  if (transform.kind === 'drop-standby-facility') {
    // 待命位置替換：拿掉待命清單的第 index 個位置，引擎要改用其他允許的位置
    const next = structuredClone(input);
    const rows = (next.maintenanceTaskBody as Record<string, { equipmentRows?: unknown[] }> | null | undefined)
      ?.mobile?.equipmentRows;
    if (!Array.isArray(rows) || rows.length <= 1 || transform.index >= rows.length) {
      return { input: next, problems: ['待命清單不足，無法做位置替換變形'] };
    }
    rows.splice(transform.index, 1);
    return { input: next, problems: [] };
  }
  if (transform.kind === 'drop-map-id') {
    const next = structuredClone(input);
    next.draft.routeGroups.mapId = '';
    return { input: next, problems: [] };
  }
  if (transform.kind === 'drop-relation-graph') {
    const next = structuredClone(input);
    const groups = next.draft.routeGroups as { routeRelationGraph?: unknown; throughAnchors?: unknown };
    groups.routeRelationGraph = { nodes: [], links: [] };
    groups.throughAnchors = undefined;
    return { input: next, problems: [] };
  }
  if (transform.kind === 'scale-travel') {
    const next = structuredClone(input);
    const scale = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value * transform.factor) : value;
    for (const edge of next.pointTopology?.edges ?? []) {
      edge.avgTravelTimeSeconds = scale(edge.avgTravelTimeSeconds) as typeof edge.avgTravelTimeSeconds;
      edge.minTravelTimeSeconds = scale(edge.minTravelTimeSeconds) as typeof edge.minTravelTimeSeconds;
    }
    for (const route of next.draft.routeGroups.selectedRoutes) {
      route.avgTravelTimeSeconds = scale(route.avgTravelTimeSeconds) as number;
      route.minTravelTimeSeconds = scale(route.minTravelTimeSeconds) as number;
      for (const leg of route.stationLegTravels ?? []) {
        leg.avgTravelTimeSeconds = scale(leg.avgTravelTimeSeconds) as number;
        leg.minTravelTimeSeconds = scale(leg.minTravelTimeSeconds) as number;
      }
    }
    // 行駛時間是驗算指紋的一部分：模擬使用者回路線群組重新檢查路線組合
    return { input: reverifyThroughFingerprint(next), problems: transform.factor > 0 ? [] : ['倍率必須大於 0'] };
  }
  if (transform.kind === 'widen-yard-boundary') {
    const next = structuredClone(input);
    const raw = next.templateBody as unknown;
    const body = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { tasks: Array<{ rowIndex: number; taskType: string; startMinute: number; durationMinutes: number }> };
    const yardTypes = new Set(['charging', 'servicing', 'inspection', 'standby', 'washing']);
    const problems: string[] = [];
    let changed = 0;
    for (const task of body.tasks) {
      if (task.taskType !== transform.taskType) continue;
      const previous = body.tasks.find(
        (other) => other !== task && other.rowIndex === task.rowIndex && yardTypes.has(other.taskType)
          && Math.abs(other.startMinute + other.durationMinutes - task.startMinute) < 1e-9,
      );
      if (!previous) continue;
      if (previous.durationMinutes <= transform.minutes) {
        problems.push(`時間線 ${task.rowIndex} 前一段只有 ${previous.durationMinutes} 分鐘，不能讓出 ${transform.minutes} 分鐘`);
        continue;
      }
      previous.durationMinutes -= transform.minutes;
      task.startMinute -= transform.minutes;
      task.durationMinutes += transform.minutes;
      changed += 1;
    }
    if (changed === 0) problems.push('沒有找到可以調整的交界');
    next.templateBody = (typeof raw === 'string' ? JSON.stringify(body) : body) as typeof next.templateBody;
    return { input: next, problems };
  }
  const next = structuredClone(input);
  (next.draft.routeGroups as { collisionProtectionSeconds?: number }).collisionProtectionSeconds = transform.seconds;
  return { input: next, problems: [] };
}

/** 問題的類別；搜尋未完成要跟「找過了沒有」分開 */
function classifyReasons(issues: FeasibilityIssue[]): string[] {
  const reasons = new Set<string>();
  for (const issue of issues) {
    const detail = (issue.detail ?? {}) as Record<string, unknown>;
    if (issue.code === 'SCHEDULE_DATA_INCOMPLETE') reasons.add('data-incomplete');
    if (issue.code === 'MISSING_TRAVEL_TIME' || (Array.isArray(detail.missingTravelTimeEdges) && detail.missingTravelTimeEdges.length > 0)) {
      reasons.add('missing-travel-time');
    }
    if (issue.code === 'SCHEDULE_SEARCH_INCOMPLETE' || detail.searchBudgetExhausted === true) reasons.add('search-incomplete');
    if (issue.code.startsWith('STATION_BERTH_')) reasons.add('station-conflict');
    if (issue.code === 'MAINTENANCE_TRANSFER_REQUIRED_MISSING') reasons.add('transfer-missing');
    if (issue.code.startsWith('FACILITY_')) reasons.add('facility-conflict');
    if (issue.code === 'MOVE_JUNCTION_CONFLICT') reasons.add('junction-conflict');
  }
  return [...reasons].sort();
}

function countByCode(issues: Array<{ code: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const issue of issues) out[issue.code] = (out[issue.code] ?? 0) + 1;
  return out;
}

function main(caseDir: string): void {
  const spec = JSON.parse(readFileSync(join(caseDir, 'spec.json'), 'utf-8')) as ReplayCaseSpec;
  const raw = readFileSync(spec.inputPath, 'utf-8');
  const summary: ReplayCaseSummary = {
    name: spec.name,
    outcome: 'crash',
    publishSafe: false,
    sourceSha256: sha256(raw),
    inputSha256: null,
    elapsedMs: 0,
    passengerTrips: 0,
    blockingByCode: {},
    recheckBlockingByCode: {},
    reasons: [],
  };
  const write = () => writeFileSync(join(caseDir, 'summary.json'), JSON.stringify(summary, null, 2));

  let input = JSON.parse(raw) as Input;
  const invalid: string[] = [];
  for (const transform of spec.transforms) {
    const applied = applyTransform(input, transform);
    invalid.push(...applied.problems);
    input = applied.input;
  }
  const inputText = JSON.stringify(input);
  summary.inputSha256 = sha256(inputText);
  const gaps = listTopologyTravelTimeGaps(input.pointTopology);
  const edgeText = (edge: { fromLabel: string; toLabel: string }) => `${edge.fromLabel} → ${edge.toLabel}`;
  summary.dataChecks = {
    missingTravelTime: gaps.missing.map(edgeText),
    explicitZeroTravelTime: gaps.explicitZero.map(edgeText),
  };
  writeFileSync(join(caseDir, 'input.json'), inputText);
  if (invalid.length > 0) {
    summary.outcome = 'invalid-input';
    summary.invalidInput = invalid;
    write();
    return;
  }

  const startedAt = Date.now();
  // 跟正式生成入口同一套生成前資料檢查（白皮書 MAP-01～03）：缺就不生成
  const dataIssues = checkScheduleInputData(input);
  const result = dataIssues.length > 0
    ? { plan: null, report: { ok: false, errors: dataIssues, warnings: [] } } as ReturnType<typeof generateShiftSchedule>
    : generateShiftSchedule(input);
  summary.elapsedMs = Date.now() - startedAt;
  writeFileSync(join(caseDir, 'result.json'), JSON.stringify(result));
  const issues = [...result.report.errors, ...result.report.warnings];
  writeFileSync(join(caseDir, 'issues.json'), JSON.stringify(issues, null, 2));
  const blocking = issues.filter((issue) => issue.severity === 'error' || PUBLISH_BLOCKING_CODES.has(issue.code));
  const recheck = result.plan
    ? runSchedulePublishCheck({
      plan: result.plan,
      selectedRoutes: input.draft.routeGroups.selectedRoutes,
      collisionProtectionSeconds: (input.draft.routeGroups as { collisionProtectionSeconds?: number }).collisionProtectionSeconds ?? 0,
      sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
      topology: input.pointTopology,
    })
    : null;
  writeFileSync(join(caseDir, 'recheck.json'), JSON.stringify(recheck, null, 2));

  summary.passengerTrips = result.plan?.timelines
    .flatMap((timeline) => timeline.blocks)
    .filter((block) => block.taskType === 'passenger').length ?? 0;
  summary.blockingByCode = countByCode(blocking);
  summary.recheckBlockingByCode = countByCode(recheck?.blockingIssues ?? []);
  summary.reasons = classifyReasons([...blocking, ...(recheck?.blockingIssues ?? [])]);
  summary.publishSafe = Boolean(result.plan) && result.report.ok && blocking.length === 0 && (recheck?.publishSafe ?? false);
  summary.outcome = summary.publishSafe
    ? 'safe'
    : summary.reasons.includes('search-incomplete') ? 'search-exhausted' : 'blocked';
  write();
}

const caseDir = process.argv[2];
if (!caseDir) {
  console.error('用法：node --import tsx scripts/schedule-safety-replay-case.mts <case-dir>');
  process.exit(2);
}
try {
  main(caseDir);
} catch (error) {
  // 寫下崩潰原因；父程序看到 outcome=crash 與非零退出碼
  writeFileSync(join(caseDir, 'crash.txt'), String((error as Error)?.stack ?? error));
  process.exit(1);
}
