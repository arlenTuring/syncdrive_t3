/**
 * 正線優先讓渡（橫條落地）：
 * 同列正線／進場載客若占用整備橫條開頭，把整備開始推到正線結束，鎖住原結束並壓縮時長。
 *
 * expand 階段已有同列 cursor 讓渡；站位延後等後處理可能再把正線拖進整備，
 * 必須在生成尾端再跑一次，否則會留下 TIMELINE_OVERLAP（例如 ST 結束 03:33:40、充電仍 03:33:30）。
 */

import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';

function isYieldableMaintenanceBlock(block: GeneratedScheduleBlock): boolean {
  if (block.source !== 'template_bar') return false;
  return (
    block.taskType === 'charging'
    || block.taskType === 'servicing'
    || block.taskType === 'inspection'
    || block.taskType === 'standby'
  );
}

function isYieldOccupyingBlock(block: GeneratedScheduleBlock): boolean {
  if (block.source === 'transition') return false;
  return block.taskType === 'passenger' || block.source === 'entry_service';
}

/**
 * 對每條時間線套用正線優先讓渡：整備開始不得早於任何重疊正線的結束。
 */
export function applyMainlineMaintenanceEntryYield(
  timelines: GeneratedSchedulePlan['timelines'],
): GeneratedSchedulePlan['timelines'] {
  return timelines.map((timeline) => {
    const blocks = timeline.blocks.map((block) => ({ ...block }));
    const ordered = [...blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );

    for (const maint of ordered) {
      if (!isYieldableMaintenanceBlock(maint)) continue;
      const lockedEndMinute = maint.plannedEndMinute;
      let nextStartMinute = maint.plannedStartMinute;

      for (const other of ordered) {
        if (other.id === maint.id) continue;
        if (!isYieldOccupyingBlock(other)) continue;
        if (
          other.plannedStartMinute < lockedEndMinute - 1e-9
          && other.plannedEndMinute > maint.plannedStartMinute + 1e-9
        ) {
          nextStartMinute = Math.max(nextStartMinute, other.plannedEndMinute);
        }
      }

      if (nextStartMinute > maint.plannedStartMinute + 1e-9) {
        maint.plannedStartMinute = nextStartMinute;
        if (nextStartMinute >= lockedEndMinute - 1e-9) {
          maint.plannedEndMinute = nextStartMinute;
        }
      }
    }

    return {
      ...timeline,
      blocks: blocks
        .filter(
          (block) =>
            !(
              isYieldableMaintenanceBlock(block)
              && block.plannedEndMinute <= block.plannedStartMinute + 1e-9
            ),
        )
        .sort(
          (a, b) =>
            a.plannedStartMinute - b.plannedStartMinute
            || a.id.localeCompare(b.id),
        ),
    };
  });
}
