/**
 * 發車相位均分：把被擠歪的班距推回等間隔。
 * ==========================================
 *
 * <strong>問題不是缺班，是相位歪了。</strong>實測資料上
 * <code>UNSERVED_SERVICE_PULSE</code> 只有 1 則——時刻表要的班次幾乎都有車接；
 * 但 <code>HEADWAY_BELOW_TARGET</code> 有 33 則，代表<strong>車有出、間隔卻忽大忽小</strong>。
 * 運能曲線的低谷主要來自這個，不是來自班次不夠。
 *
 * 歪的來源是站位求解：它為了清開停靠點會把個別班次往後延
 * （<code>STATION_BERTH_DELAYED</code> 51 則），<strong>每延一次就把相位推歪一次，
 * 而且沒有任何機制把它推回來</strong>。這一支就是那個回推。
 *
 * <strong>做法：往鄰居的中點靠（Laplacian 平滑）。</strong>同一條路線相鄰三班
 * A→B→C，B 理想上該落在 A 與 C 的正中間。把 B 往中點移，班距的變異數必然下降——
 * <strong>不需要知道目標班距是多少</strong>，也就不需要任何寫死的參數。
 * 目標班距那個數字只用在回報，不該再進求解。
 *
 * <strong>三道防振盪的保險：</strong>
 * <ol>
 *   <li><strong>阻尼</strong>——一次只走一半的距離。走滿容易跟站位求解對撞，走一半
 *       會單調收斂。</li>
 *   <li><strong>一趟只均分一次</strong>——記在區塊身上（跨得了收斂迴圈的輪次）。
 *       這是先前「滯留車讓路」踩過的坑：狀態記在函式區域變數＝每輪重置＝振盪。</li>
 *   <li><strong>只在自己列的空檔內移動</strong>——前後段的邊界是硬的，絕不越界。
 *       邊界必須<strong>當場重算</strong>：第一版用函式開頭的快照，同列有兩班都移動時
 *       第二班拿到過期邊界，兩班互相跨過去，該列順序就變了。</li>
 * </ol>
 *
 * 移動後可能踩到站位；放在收斂迴圈裡，交給站位求解在下一輪反應。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GeneratedScheduleBlock,
} from './schedule-engine/types';

/**
 * 一次走多少比例。
 *
 * 1.0（直接放到中點）在跟站位求解共存時會來回；0.5 是標準的阻尼平滑，
 * 每一輪把偏差砍半，數輪之內就貼合，而且不會過衝。
 */
const DAMPING = 0.5;

/** 小於這個幅度就不動——省得為了幾秒鐘去驚動站位求解 */
const MIN_SHIFT_MINUTES = 1 / 6;

export function evenOutRouteHeadwayPhase(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { adjusted: number } {
  const { timelines, minimumRecoveryTimeSeconds, warnings } = args;
  const gapMinutes = Math.max(0, minimumRecoveryTimeSeconds) / 60;

  /** 每一列自己的區塊順序——移動的硬邊界 */
  const rowBlocks = new Map<number, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    rowBlocks.set(
      timeline.row,
      [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute),
    );
  }

  /** 同一條路線的發車序列＝班距序列 */
  const byRoute = new Map<string, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger' || block.source !== 'template_bar') continue;
      const key = block.routeInstanceId?.trim() || block.routeId?.trim();
      if (!key) continue;
      const list = byRoute.get(key) ?? [];
      list.push(block);
      byRoute.set(key, list);
    }
  }

  let adjusted = 0;
  let totalShift = 0;
  for (const [, list] of byRoute) {
    const sequence = [...list].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let i = 1; i < sequence.length - 1; i += 1) {
      const block = sequence[i]!;
      if (block.headwayPhaseEvened) continue;
      const before = sequence[i - 1]!;
      const after = sequence[i + 1]!;
      // 同一列的兩班不構成班距（那是同一台車的前後趟，不是兩台車的間隔）
      if (before.timelineRow === block.timelineRow) continue;
      if (after.timelineRow === block.timelineRow) continue;

      const ideal = (before.plannedStartMinute + after.plannedStartMinute) / 2;
      let shift = (ideal - block.plannedStartMinute) * DAMPING;
      if (Math.abs(shift) < MIN_SHIFT_MINUTES) continue;

      /**
       * 只能在自己列的空檔裡動，絕不越界——而且邊界要<strong>當場重算</strong>。
       *
       * 第一版把每一列的順序在函式開頭抓成快照，之後照著快照取前後鄰居。
       * 同一列有兩班都被均分時，第二班拿到的是<strong>過期的邊界</strong>，
       * 於是兩班可能互相跨過去，該列的順序就變了——實測直接冒出
       * <code>ROUTE_STATION_DISCONTINUITY</code> 與
       * <code>ROUTE_SUCCESSOR_MISMATCH</code> 各 4 則，兩者都是 error
       * （2026-08-13 使用者的 log）。
       *
       * 「不可能製造重疊」的推論本身沒錯，錯在它建立在<strong>邊界是新鮮的</strong>
       * 這個沒被滿足的假設上。
       */
      const siblings = (rowBlocks.get(block.timelineRow) ?? [])
        .slice()
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
      const index = siblings.findIndex((item) => item.id === block.id);
      const previousSibling = index > 0 ? siblings[index - 1] : undefined;
      const nextSibling = index >= 0 ? siblings[index + 1] : undefined;
      const duration = block.plannedEndMinute - block.plannedStartMinute;
      const lowerBound = previousSibling
        ? previousSibling.plannedEndMinute + gapMinutes
        : Number.NEGATIVE_INFINITY;
      const upperBound = nextSibling
        ? nextSibling.plannedStartMinute - gapMinutes - duration
        : Number.POSITIVE_INFINITY;
      const target = Math.min(
        Math.max(block.plannedStartMinute + shift, lowerBound),
        upperBound,
      );
      shift = target - block.plannedStartMinute;
      if (Math.abs(shift) < MIN_SHIFT_MINUTES) continue;

      block.plannedStartMinute += shift;
      block.plannedEndMinute += shift;
      block.headwayPhaseEvened = true;
      adjusted += 1;
      totalShift += Math.abs(shift);
    }
  }

  if (adjusted > 0) {
    for (const timeline of timelines) {
      timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    }
    warnings?.push({
      code: 'HEADWAY_PHASE_EVENED',
      severity: 'warning',
      kind: 'policy',
      message:
        `已把 ${adjusted} 班的發車時刻往「與前後班等間隔」的位置推回`
        + `（合計移動 ${totalShift.toFixed(1)} 分鐘）。`
        + `站位求解為了清開停靠點會把個別班次往後延，每延一次相位就歪一次；`
        + `這一步只在該列自己的空檔內微調，不新增也不刪除任何班次。`,
      detail: { adjustedTripCount: adjusted, totalShiftMinutes: totalShift },
    });
  }
  return { adjusted };
}
