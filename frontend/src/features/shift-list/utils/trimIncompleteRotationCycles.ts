/**
 * 站位改線／日終收斂後，正線趟數可能不是交路週期整數倍。
 * 引擎策略：寧可撤未成輪的尾巴，也不留下 ROTATION_CYCLE_INCOMPLETE。
 *
 * 以整備（充電／保養／點檢／待機）切段：每一正線段各自必須成輪，
 * 不可把「全天總數剛好整除」當成過關——否則會出現充電前收在 ST、缺 TN。
 */
import type { GeneratedScheduleBlock, GeneratedSchedulePlan } from './schedule-engine/types';

export type TrimIncompleteRotationResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 各時間線被撤掉的正線數 */
  trimmedByRow: Record<number, number>;
  trimmedTotal: number;
};

function isCountablePassengerTrip(block: GeneratedScheduleBlock): boolean {
  return block.source === 'template_bar' && block.taskType === 'passenger';
}

function isYardSeparator(block: GeneratedScheduleBlock): boolean {
  if (block.source !== 'template_bar') return false;
  return (
    block.taskType === 'charging'
    || block.taskType === 'servicing'
    || block.taskType === 'inspection'
    || block.taskType === 'standby'
  );
}

/**
 * 每條時間線：依整備切段，各段正線趟數不是 routeCount 整數倍時，
 * 由該段末班往前撤到整輪為止。日終未接整備的尾巴同樣處理。
 * routeCount ≤ 1 時不動作。
 */
export function trimIncompleteRotationCyclesOnTimelines(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 主交路筆數（不含僅掛 backupFor* 的列） */
  routeCount: number;
  /** 撤掉一班時告知（報表逐班揭露） */
  onRemoved?: (blockId: string) => void;
}): TrimIncompleteRotationResult {
  const routeCount = Math.max(0, Math.floor(args.routeCount));
  if (routeCount <= 1) {
    return {
      timelines: args.timelines,
      trimmedByRow: {},
      trimmedTotal: 0,
    };
  }

  const trimmedByRow: Record<number, number> = {};
  let trimmedTotal = 0;

  const timelines = args.timelines.map((timeline) => {
    const ordered = [...timeline.blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );

    const dropIds = new Set<string>();
    let stretch: GeneratedScheduleBlock[] = [];

    const flushStretch = () => {
      if (stretch.length === 0) return;
      const remainder = stretch.length % routeCount;
      if (remainder > 0) {
        for (const block of stretch.slice(stretch.length - remainder)) {
          dropIds.add(block.id);
          args.onRemoved?.(block.id);
        }
      }
      stretch = [];
    };

    for (const block of ordered) {
      if (isYardSeparator(block)) {
        flushStretch();
        continue;
      }
      if (isCountablePassengerTrip(block)) {
        stretch.push(block);
      }
    }
    flushStretch();

    if (dropIds.size === 0) return timeline;
    trimmedByRow[timeline.row] = dropIds.size;
    trimmedTotal += dropIds.size;
    return {
      ...timeline,
      blocks: timeline.blocks.filter((block) => !dropIds.has(block.id)),
    };
  });

  return { timelines, trimmedByRow, trimmedTotal };
}
