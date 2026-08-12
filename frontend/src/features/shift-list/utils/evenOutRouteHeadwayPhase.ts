/**
 * 發車相位均分：把被擠歪的班距推回等間隔（自己驗證站位版）。
 * ==============================================================
 *
 * <strong>診斷已被證實。</strong>實測資料上 <code>UNSERVED_SERVICE_PULSE</code> 只有
 * 個位數——時刻表要的班次幾乎都有車接；<code>HEADWAY_BELOW_TARGET</code> 卻高達 141 則，
 * 代表<strong>車有出、間隔卻忽大忽小</strong>。第一版做完這一步，那個數字一度掉到
 * <strong>18</strong>——運能曲線的低谷確實來自相位歪斜，不是缺班。
 *
 * 歪的來源是站位求解：它為了清開停靠點會把個別班次<strong>往後延</strong>，
 * 每延一次相位就歪一次，而且原本沒有任何機制把它推回來。
 *
 * <strong>第一版為什麼被撤掉。</strong>它移完就丟給站位求解收拾，但兩者的<strong>調整方向
 * 相反</strong>——這裡往前移、求解器只會往後延。移前面就被延回去，收益被抵銷；
 * <strong>延不動的地方就變成硬碰撞</strong>（實測 <code>STATION_BERTH_COLLISION</code>
 * 0 → 4）。硬錯誤會讓整張班表不通過閘門，用它換班距是錯的交換。
 *
 * <strong>這一版的鐵律：自己驗證、自己放棄。</strong>移動之前先算出「這一班挪到新位置
 * 之後，它在每一個停靠站的佔用窗」，逐一比對別列車——只要有<strong>任何一個</strong>站
 * 不滿足「後車到站 ≥ 前車實際離站 + 2 × 碰撞保護」，這一筆<strong>整筆放棄</strong>，
 * 不移。絕不製造出下游修不掉的東西。
 *
 * 其餘三道保險沿用：阻尼（一次走一半，單調收斂不過衝）、一趟只均分一次
 * （記在區塊身上，跨得了收斂迴圈的輪次）、只在自己列的空檔內移動且邊界<strong>當場重算</strong>
 * （用函式開頭的快照會讓同列兩班互相跨過去，實測冒出 4 則路線 error）。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GeneratedScheduleBlock,
} from './schedule-engine/types';
import {
  collectStationBerthOccupancies,
  type StationBerthOccupancy,
} from './stationBerthOccupancy';

/**
 * 一次走多少比例。
 *
 * 1.0（直接放到中點）容易過衝；0.5 是標準的阻尼平滑，每一輪把偏差砍半，
 * 數輪之內貼合，而且不會越過目標。
 */
const DAMPING = 0.5;

/** 小於這個幅度就不動——省得為了幾秒鐘去驚動站位求解 */
const MIN_SHIFT_MINUTES = 1 / 6;

export function evenOutRouteHeadwayPhase(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  collisionProtectionSeconds: number;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { adjusted: number } {
  const {
    timelines,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
    collisionProtectionSeconds,
    warnings,
  } = args;
  const gapMinutes = Math.max(0, minimumRecoveryTimeSeconds) / 60;

  // 站位佔用表：移動的可行性完全由它裁決
  const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
    collisionProtectionSeconds,
  });
  const byStation = new Map<string, StationBerthOccupancy[]>();
  const byBlock = new Map<string, StationBerthOccupancy[]>();
  for (const occ of occupancies) {
    const stationList = byStation.get(occ.stationId) ?? [];
    stationList.push(occ);
    byStation.set(occ.stationId, stationList);
    const blockList = byBlock.get(occ.blockId) ?? [];
    blockList.push(occ);
    byBlock.set(occ.blockId, blockList);
  }

  /**
   * 這一班整段挪 <code>shift</code> 分鐘之後，每一個停靠站都還清得開嗎。
   *
   * 判準跟 <code>findStationBerthCollisions</code> <strong>同一條</strong>：
   * 區間不得重疊，且後車到站不得早於前車的保護結束時刻。兩邊都要檢查——
   * 挪動可能讓自己變成後車，也可能變成前車。
   */
  const moveKeepsBerthsClear = (block: GeneratedScheduleBlock, shift: number): boolean => {
    for (const own of byBlock.get(block.id) ?? []) {
      const start = own.startMinute + shift;
      const depart = own.actualDepartMinute + shift;
      const protectedUntil = own.protectedUntilMinute + shift;
      for (const other of byStation.get(own.stationId) ?? []) {
        if (other.blockId === block.id) continue;
        if (other.timelineRow === block.timelineRow) continue;
        const overlaps =
          start < other.actualDepartMinute - 1e-9 && other.startMinute < depart - 1e-9;
        if (overlaps) return false;
        // 自己在後：到站要等到對方的保護結束
        if (start >= other.actualDepartMinute - 1e-9 && start < other.protectedUntilMinute - 1e-9) {
          return false;
        }
        // 自己在前：對方到站要等到自己的保護結束
        if (
          other.startMinute >= depart - 1e-9
          && other.startMinute < protectedUntil - 1e-9
        ) {
          return false;
        }
      }
    }
    return true;
  };

  /**
   * 要均分的序列有<strong>兩種</strong>。
   *
   * <ol>
   *   <li><strong>同一條路線</strong>——那是乘客感受到的班距。</li>
   *   <li><strong>同一個發車站</strong>——那是<strong>停靠點</strong>感受到的擁擠。</li>
   * </ol>
   *
   * 第一版只照路線分組，於是<strong>跑不同路線、卻共用同一個停靠點</strong>的兩台車
   * 從來沒被放在一起比較過。實測正是這樣：TN0536（列 3）與 TN0542（列 4）在
   * 「N2W下行出發」<strong>離站時刻完全相同</strong>（05:59:30），兩台都在那裡空等十幾分鐘，
   * 加上一台路過的就變成 3 台擠 1 格——<code>STATION_BERTH_PROTECTION_GAP</code>
   * 剩下的兩則就是這個（2026-08-13）。
   *
   * 兩種序列都跑一遍：路線的均分讓班距平順，站別的均分讓停靠點不擁擠。
   * 站別那一輪用<strong>路線的 instance 當前綴</strong>是不行的——那又退回第一種了；
   * 直接用起點站當鍵。
   */
  const buildSequences = (
    keyOf: (block: GeneratedScheduleBlock) => string | null,
  ): GeneratedScheduleBlock[][] => {
    const grouped = new Map<string, GeneratedScheduleBlock[]>();
    for (const timeline of timelines) {
      for (const block of timeline.blocks) {
        if (block.taskType !== 'passenger' || block.source !== 'template_bar') continue;
        const key = keyOf(block);
        if (!key) continue;
        const list = grouped.get(key) ?? [];
        list.push(block);
        grouped.set(key, list);
      }
    }
    return [...grouped.values()];
  };
  const originStationOf = (block: GeneratedScheduleBlock): string | null => {
    const route = selectedRoutes.find(
      (item) =>
        item.routeId === block.routeId
        && (!block.routeInstanceId || (item.instanceId ?? item.routeId) === block.routeInstanceId),
    ) ?? selectedRoutes.find((item) => item.routeId === block.routeId);
    return route?.stationIds?.[0]?.trim() || null;
  };
  const sequences = [
    ...buildSequences((block) => block.routeInstanceId?.trim() || block.routeId?.trim() || null),
    ...buildSequences(originStationOf),
  ];

  let adjusted = 0;
  let abandoned = 0;
  let totalShift = 0;
  for (const list of sequences) {
    const sequence = [...list].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    for (let i = 1; i < sequence.length - 1; i += 1) {
      const block = sequence[i]!;
      if (block.headwayPhaseEvened) continue;
      const before = sequence[i - 1]!;
      const after = sequence[i + 1]!;
      // 同一列的兩班不構成班距（那是同一台車的前後趟，不是兩台車的間隔）
      if (before.timelineRow === block.timelineRow) continue;
      if (after.timelineRow === block.timelineRow) continue;

      /**
       * <strong>整備後第一班不准挪。</strong>
       *
       * 它的發車時刻被<strong>出廠卡釘住</strong>——卡片的結束要貼齊發車，車才剛從
       * 設施開出來。整段挪走，出場站就接不上，直接觸發
       * <code>YARD_EXIT_STATION_MISMATCH</code>（error）。
       *
       * 同一個坑在 <code>yieldIdleBlockArrival</code> 已經修過一次，這裡沒有套上
       * ——實測冒出 2 則（2026-08-13）。<strong>會移動時刻的處理，這條限制一律適用</strong>，
       * 不是各自為政的特例。
       */
      const rowSiblingsForPin = [
        ...(timelines.find((t) => t.row === block.timelineRow)?.blocks ?? []),
      ].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
      const pinIndex = rowSiblingsForPin.findIndex((item) => item.id === block.id);
      const beforeInRow = pinIndex > 0 ? rowSiblingsForPin[pinIndex - 1] : undefined;
      if (
        beforeInRow
        && beforeInRow.source === 'template_bar'
        && beforeInRow.taskType !== 'passenger'
      ) {
        continue;
      }

      const ideal = (before.plannedStartMinute + after.plannedStartMinute) / 2;
      let shift = (ideal - block.plannedStartMinute) * DAMPING;
      if (Math.abs(shift) < MIN_SHIFT_MINUTES) continue;

      // 只能在自己列的空檔裡動，邊界當場重算（快照會讓同列兩班互相跨過去）
      const siblings = [...(timelines.find((t) => t.row === block.timelineRow)?.blocks ?? [])]
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

      // 站位不通就整筆放棄——不移完丟給站位求解收拾（第一版就是這樣製造出硬碰撞的）
      if (!moveKeepsBerthsClear(block, shift)) {
        abandoned += 1;
        continue;
      }

      block.plannedStartMinute += shift;
      block.plannedEndMinute += shift;
      block.headwayPhaseEvened = true;
      // 佔用表同步跟著移，後面的候選才是拿新版位置在比
      for (const own of byBlock.get(block.id) ?? []) {
        own.startMinute += shift;
        own.endMinute += shift;
        own.actualDepartMinute += shift;
        own.protectedUntilMinute += shift;
        own.blockStartMinute += shift;
        own.blockEndMinute += shift;
      }
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
        + `（合計移動 ${totalShift.toFixed(1)} 分鐘）`
        + (abandoned > 0 ? `；另有 ${abandoned} 班挪過去會撞站位，整筆放棄沒動` : '')
        + `。站位求解為了清開停靠點會把個別班次往後延，每延一次相位就歪一次；`
        + `這一步只在該列自己的空檔內微調，且移動前已逐站確認不會碰撞，`
        + `不新增也不刪除任何班次。`,
      detail: {
        adjustedTripCount: adjusted,
        abandonedTripCount: abandoned,
        totalShiftMinutes: totalShift,
      },
    });
  }
  return { adjusted };
}
