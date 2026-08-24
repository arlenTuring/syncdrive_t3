import type { ShiftScheduleSelectedRoute } from '../../types/create';
import type {
  TimeSlotAttribute,
  TimeSlotInterval,
} from '../../../time-templates/types/editor';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './types';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from '../stationBerthOccupancy';
import {
  validateFacilityOccupancy,
  validatePassengerHeadway,
  validateTimelineOverlaps,
} from './validate';

/**
 * 班表全域評分
 * ============
 *
 * <strong>為什麼需要這個。</strong>幾何後處理迴圈裡有十二道處理，每一道都有自己的
 * 「自我驗證」——但每一道量的是<strong>不同的東西</strong>：站位讓渡只看碰撞對數、
 * 班距修復只看班距、站位求解只看站位。沒有任何一個地方衡量整張班表好不好。
 *
 * 後果是這十二道會互相推翻：A 為了自己的指標改動，破壞 B 的指標，B 再改回來破壞 A。
 * 實測（2026-08-20，把每一輪的變動卡數印出來）：
 *
 *   好的輸入   round 0 變動 1013 張 → round 13 仍在動 82 張（從未收斂）
 *   壞的輸入   round 0 變動 1070 張 → round 5 降到 435 → round 9 反彈 765（發散）
 *
 * 也就是說引擎回傳的<strong>不是一個解，是震盪過程中第 14 輪剛好停下來的那一格</strong>。
 * 輸入動一點點就落到軌跡上另一個點——使用者在地圖上多開 7 條邊，班表就從
 * 硬錯誤 0／班次 1096 變成硬錯誤 4／班次 972。
 *
 * <strong>優先序是使用者定的</strong>（2026-08-17）：「最高原則就是不碰撞，班距盡量
 * 正常，班次穩定運行，PPHPD 能達到位」。所以評分是<strong>字典序</strong>的向量，
 * 不是加權總和——加權會允許「多跑幾班換一次碰撞」這種交換，那是明確被否決的。
 *
 * <strong>定義直接沿用最終驗證器</strong>（{@link validateTimelineOverlaps}、
 * {@link validatePassengerHeadway}），不另外手寫一套。評分與使用者在報告上看到的
 * 東西必須是同一個定義，否則會出現「引擎說這輪比較好、報告卻顯示比較差」。
 *
 * <strong>唯一的例外是站位碰撞：直接數，不經過報告器。</strong>
 * {@link validateStationBerthCollisions} 為了不洗版，同一個 code 最多只寫
 * <code>MAX_BERTH_COLLISION_REPORTS</code>（40）則。拿它來評分的話，分數會在 40
 * 飽和——超過 40 之後所有版面看起來一樣好，閘門就瞎了（2026-08-20 實測，分數向量
 * 第二位長時間卡在 40）。所以這裡呼叫 {@link findStationBerthCollisions} 拿未截斷
 * 的完整清單自己數。
 */

/** 分數向量：<strong>逐位比較，每一位都是越小越好</strong> */
export type PlanScore = {
  vector: number[];
  detail: {
    /** 硬錯誤：時間線重疊、站位碰撞對、班距低於物理下限——無效班表，壓倒一切 */
    hardErrorCount: number;
    /** 碰撞保護不足的班次對數 */
    protectionGapPairs: number;
    /** 班距低於目標的次數 */
    headwayBelowTargetCount: number;
    /** 載客班次數（越多越好，向量裡取負） */
    passengerTripCount: number;
    /** 列間班次差距（最多的列 − 最少的列，越小越平均） */
    tripSpreadAcrossRows: number;
  };
};

export function scoreSchedulePlan(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  intervals: TimeSlotInterval[];
  attributes: TimeSlotAttribute[];
  routeById: Map<string, ShiftScheduleSelectedRoute>;
  collisionProtectionSeconds: number;
  scheduleRowCount: number;
}): PlanScore {
  const {
    timelines,
    selectedRoutes,
    intervals,
    attributes,
    routeById,
    collisionProtectionSeconds,
    scheduleRowCount,
  } = args;

  // 丟棄用的收集器：這裡只要數量，訊息不進報告
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];

  validateTimelineOverlaps(timelines, errors);
  /**
   * 設施格重疊也算硬錯誤——兩台車同時在一格是物理上做不到的事。
   *
   * 不放進來的話，任何「把車從格子裡早點放出來」的處理都會被閘門判定成「沒變好」
   * 而撤回：它修的東西根本不在分數裡。交接不足（警告）不計入，那是營運規則不是
   * 物理事實，收進第二位會讓它壓過班距。
   */
  validateFacilityOccupancy(timelines, errors, { collisionProtectionSeconds });

  // 站位碰撞自己數，避開報告器 40 則的截斷
  const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
    collisionProtectionSeconds,
  });
  const collisions = findStationBerthCollisions(occupancies, selectedRoutes);
  let berthCollisionPairs = 0;
  let protectionGapPairs = 0;
  for (const hit of collisions) {
    if (hit.kind === 'protection_gap') protectionGapPairs += 1;
    else berthCollisionPairs += 1;
  }

  const allBlocks: GeneratedScheduleBlock[] = [];
  for (const timeline of timelines) allBlocks.push(...timeline.blocks);
  validatePassengerHeadway(
    allBlocks,
    intervals,
    attributes,
    routeById,
    errors,
    warnings,
    scheduleRowCount,
  );

  let headwayBelowTargetCount = 0;
  for (const issue of warnings) {
    if (issue.code === 'HEADWAY_BELOW_TARGET') headwayBelowTargetCount += 1;
  }

  let passengerTripCount = 0;
  const tripsByRow: number[] = [];
  for (const timeline of timelines) {
    let count = 0;
    for (const block of timeline.blocks) {
      if (block.taskType === 'passenger') count += 1;
    }
    passengerTripCount += count;
    tripsByRow.push(count);
  }
  const tripSpreadAcrossRows = tripsByRow.length === 0
    ? 0
    : Math.max(...tripsByRow) - Math.min(...tripsByRow);

  const detail = {
    hardErrorCount: errors.length + berthCollisionPairs,
    protectionGapPairs,
    headwayBelowTargetCount,
    passengerTripCount,
    tripSpreadAcrossRows,
  };

  return {
    // 不碰撞 > 班距 > 班次穩定；PPHPD 由班次數代表（承接率是它的下游）
    vector: [
      detail.hardErrorCount,
      detail.protectionGapPairs,
      detail.headwayBelowTargetCount,
      -detail.passengerTripCount,
      detail.tripSpreadAcrossRows,
    ],
    detail,
  };
}

/** 負數＝a 比較好；0＝一樣；正數＝b 比較好 */
export function comparePlanScores(a: PlanScore, b: PlanScore): number {
  const length = Math.max(a.vector.length, b.vector.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.vector[index] ?? 0;
    const right = b.vector[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

export function formatPlanScore(score: PlanScore): string {
  const d = score.detail;
  return (
    `硬錯誤 ${d.hardErrorCount}／保護不足 ${d.protectionGapPairs} 對／`
    + `班距不足 ${d.headwayBelowTargetCount}／班次 ${d.passengerTripCount}／`
    + `列間差 ${d.tripSpreadAcrossRows}`
  );
}
