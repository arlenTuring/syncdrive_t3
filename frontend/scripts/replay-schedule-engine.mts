#!/usr/bin/env -S npx tsx
/**
 * 排班引擎離線重播：直接讀 backend/logs/schedule-engine/ 底下有時間戳的完整輸入 log，
 * 原封不動餵給 generateShiftSchedule()，不經過任何會存檔／部署班表的入口。
 *
 * 用法：
 *   npx tsx scripts/replay-schedule-engine.mts <engine-input.json> [--out result.json] [--compare prev-metrics.json]
 *
 * 輸出一份量測摘要（JSON）：安全衝突、必要移動缺失、班次數、未承接脈衝、班距、整備完成、
 * 發布檢查、運算時間。--out 另存完整 plan＋report；--compare 印出跟上一份摘要的差異。
 * 各階段都用同一把尺量，才看得出改動是改善還是只是換了地方出問題。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { GenerateShiftScheduleInput } from '../src/features/shift-list/utils/schedule-engine/generate';
import { evaluateScheduleAcceptance } from '../src/features/shift-list/utils/scheduleAcceptance';
import { runSchedulePublishCheck } from '../src/features/shift-list/utils/schedulePublishCheck';

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('--'));
const flag = (name: string): string | null => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? null : null;
};
if (!inputPath) {
  console.error('用法：npx tsx scripts/replay-schedule-engine.mts <engine-input.json> [--out result.json] [--compare prev.json]');
  process.exit(1);
}

const engineInput = JSON.parse(readFileSync(inputPath, 'utf-8')) as GenerateShiftScheduleInput;
const startedAt = Date.now();
const result = generateShiftSchedule(engineInput);
const elapsedMs = Date.now() - startedAt;
const { plan, report } = result;

const all = [...report.errors, ...report.warnings];
const byCode = (code: string) => all.filter((issue) => issue.code === code);
const countByCode = (issues: typeof all) => {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
};

const maintenance: Record<string, { blocks: number; minutes: number; unavailable: number }> = {};
let passengerTrips = 0;
let addedSlackBlocks = 0;
for (const timeline of plan?.timelines ?? []) {
  for (const block of timeline.blocks) {
    if (block.taskType === 'passenger') passengerTrips += 1;
    if ((block as { dwellSlackAdjustment?: unknown }).dwellSlackAdjustment) addedSlackBlocks += 1;
    if (block.source === 'hold') continue;
    if (!['charging', 'servicing', 'inspection', 'washing', 'standby'].includes(block.taskType)) continue;
    const entry = (maintenance[block.taskType] ??= { blocks: 0, minutes: 0, unavailable: 0 });
    entry.blocks += 1;
    entry.minutes += block.plannedEndMinute - block.plannedStartMinute;
    if (block.yardFacilityUnavailable) entry.unavailable += 1;
  }
}
for (const entry of Object.values(maintenance)) entry.minutes = Math.round(entry.minutes);

const acceptance = evaluateScheduleAcceptance(report);
const publishCheck = plan
  ? runSchedulePublishCheck({
    plan,
    selectedRoutes: engineInput.draft.routeGroups.selectedRoutes,
    collisionProtectionSeconds: engineInput.draft.routeGroups.collisionProtectionSeconds ?? 0,
    topology: engineInput.pointTopology,
  })
  : null;

const summary = {
  input: inputPath,
  elapsedMs,
  ok: report.ok,
  publishSafe: acceptance.publishSafe,
  publishBlockingByCode: acceptance.publishBlockingByCode,
  recheckPublishSafe: publishCheck?.publishSafe ?? null,
  recheckBlockingByCode: publishCheck?.publishBlockingByCode ?? null,
  safety: {
    stationOverlap: byCode('STATION_BERTH_COLLISION').length,
    stationProtectionGap: byCode('STATION_BERTH_PROTECTION_GAP').length,
    facilityOverlap: byCode('FACILITY_SLOT_COLLISION').length,
    facilityHandoverGap: byCode('FACILITY_HANDOVER_GAP').length,
    junctionConflict: byCode('MOVE_JUNCTION_CONFLICT').length,
    locationDiscontinuity: byCode('VEHICLE_LOCATION_DISCONTINUITY').length,
    requiredTransferMissing: byCode('MAINTENANCE_TRANSFER_REQUIRED_MISSING').length,
  },
  passengerTrips,
  unservedPulses: byCode('UNSERVED_SERVICE_PULSE').length,
  headwayBelowTarget: byCode('HEADWAY_BELOW_TARGET').length,
  addedSlackBlocks,
  maintenance,
  errors: countByCode(report.errors),
  warnings: countByCode(report.warnings),
  blockingMessages: all
    .filter((issue) => issue.severity === 'error' || acceptance.publishBlockingByCode[issue.code])
    .map((issue) => `${issue.code}: ${issue.message.split('\n')[0]}`),
};

console.log(JSON.stringify(summary, null, 2));

const outPath = flag('out');
if (outPath) writeFileSync(outPath, JSON.stringify({ plan, report }));

const comparePath = flag('compare');
if (comparePath) {
  const previous = JSON.parse(readFileSync(comparePath, 'utf-8')) as typeof summary;
  const keys = ['publishSafe', 'safety', 'passengerTrips', 'unservedPulses', 'headwayBelowTarget', 'addedSlackBlocks', 'elapsedMs'] as const;
  console.error('\n差異（前 → 後）');
  for (const key of keys) {
    console.error(`  ${key.padEnd(20)} ${JSON.stringify(previous[key])} → ${JSON.stringify(summary[key])}`);
  }
}
