#!/usr/bin/env -S npx tsx
/**
 * 排班引擎離線重播：直接讀 backend/logs/schedule-engine/ 底下有時間戳的完整輸入 log，
 * 原封不動餵給 generateShiftSchedule()，不經過任何會存檔／部署班表的入口。
 *
 * 用法：npx tsx scripts/replay-schedule-engine.mts <engine-input.json 路徑>
 */
import { readFileSync } from 'node:fs';
import { generateShiftSchedule } from '../src/features/shift-list/utils/schedule-engine/generate';
import type { GenerateShiftScheduleInput } from '../src/features/shift-list/utils/schedule-engine/generate';
import { buildScheduleEngineLastIssuesSnapshot } from '../src/features/shift-list/utils/scheduleEngineLastIssues';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('用法：npx tsx scripts/replay-schedule-engine.mts <engine-input.json 路徑>');
  process.exit(1);
}

const engineInput = JSON.parse(readFileSync(inputPath, 'utf-8')) as GenerateShiftScheduleInput;

const result = generateShiftSchedule(engineInput);
const snapshot = buildScheduleEngineLastIssuesSnapshot({
  draft: engineInput.draft,
  result,
  shiftId: engineInput.shiftId,
});

const byCode = new Map<string, number>();
for (const item of snapshot.items) {
  byCode.set(item.code, (byCode.get(item.code) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      shiftId: snapshot.shiftId,
      shiftName: snapshot.shiftName,
      ok: snapshot.ok,
      errorCount: snapshot.errorCount,
      warningCount: snapshot.warningCount,
      byCode: Object.fromEntries([...byCode.entries()].sort()),
      facilitySlotCollisions: snapshot.items
        .filter((i) => i.code === 'FACILITY_SLOT_COLLISION')
        .map((i) => i.detail),
      facilityHandoverGaps: snapshot.items
        .filter((i) => i.code === 'FACILITY_HANDOVER_GAP')
        .map((i) => ({ message: i.message, detail: i.detail })),
      timelineCount: result.plan?.timelines.length ?? null,
      blockCount:
        result.plan?.timelines.reduce((sum, t) => sum + t.blocks.length, 0) ?? null,
      maintenanceTransferUnresolved: snapshot.items
        .filter((i) => i.code === 'MAINTENANCE_TRANSFER_UNRESOLVED')
        .map((i) => ({ message: i.message, detail: i.detail })),
      row1BlocksAroundFifteen: (result.plan?.timelines.find((t) => t.row === 1)?.blocks ?? [])
        .filter((b) => b.plannedStartMinute >= 14 * 60 && b.plannedStartMinute <= 16 * 60)
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)
        .map((b) => ({
          id: b.id,
          taskType: b.taskType,
          source: b.source,
          start: b.plannedStartMinute,
          end: b.plannedEndMinute,
          yardFacilityNodeId: b.yardFacilityNodeId,
          yardExitFacilityNodeId: b.yardExitFacilityNodeId,
        })),
    },
    null,
    2,
  ),
);
