/**
 * 滯留的那台晚一點進站，讓路過的先走。
 * ======================================
 *
 * <strong>一直沒被用到的那 17 分鐘。</strong>
 *
 * 站位求解到目前為止只有一種讓步方向：<strong>延後後車的發車</strong>
 * （<code>STATION_BERTH_DELAYED</code>）。但真實情形常常反過來——
 *
 * <pre>
 *   N2W下行出發 07:16:40 同時有 2 台：
 *     TN0703  （時間線 5）07:07:00–07:24:00   ← 佔了 17 分鐘，其中大半是空等
 *     PTN0713（時間線 8）07:16:40–07:16:50   ← 只佔 10 秒，單純路過
 * </pre>
 *
 * 擋路的是<strong>滯留的那台</strong>，不是路過的那台。而滯留那台 07:07 就到了、
 * 07:24 才要開走，中間十幾分鐘車就杵在月台上——<strong>它晚幾分鐘到站完全沒有損失</strong>，
 * 下一趟的發車時刻一點都不用動。這段餘裕一直擺在那裡沒人用。
 *
 * 這一支就是把它用掉：把<strong>滯留車那一趟整段往後挪</strong>，挪到路過的那台
 * 通過之後再進站。班距不變、路線不換、下一趟發車不動——<strong>零代價</strong>。
 *
 * 為什麼既有機制做不到：<code>enforceStationBerthConstraints</code> 依開始時刻
 * 逐一處理，輪到後車時前車已經定案，只能動後車。要動前車就得回頭改已經處理過的，
 * 所以獨立成一道後處理，放在收斂迴圈裡讓站位求解有機會反應。
 */
import type { ShiftScheduleSelectedRoute } from '../types/create';
import type {
  FeasibilityIssue,
  GeneratedSchedulePlan,
  GeneratedScheduleBlock,
} from './schedule-engine/types';
import {
  collectStationBerthOccupancies,
  findStationBerthCollisions,
} from './stationBerthOccupancy';

export function yieldIdleBlockArrival(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  collisionProtectionSeconds: number;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { shifted: number } {
  const { timelines, selectedRoutes, collisionProtectionSeconds, warnings } = args;
  if (collisionProtectionSeconds <= 0) return { shifted: 0 };

  const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
    collisionProtectionSeconds,
  });
  const collisions = findStationBerthCollisions(occupancies, selectedRoutes);

  const blockById = new Map<string, GeneratedScheduleBlock>();
  const blocksByRow = new Map<number, GeneratedScheduleBlock[]>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) blockById.set(block.id, block);
    blocksByRow.set(
      timeline.row,
      [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute),
    );
  }

  const protectionMinutes = collisionProtectionSeconds / 60;
  const shiftedBlockIds = new Set<string>();
  /* 每一站彙總成一則。逐筆列出會有上百則，把已經整理好的摘要淹掉。 */
  const perStation = new Map<string, { stationName: string; count: number; totalShift: number }>();
  let shifted = 0;

  for (const hit of collisions) {
    if (hit.kind !== 'protection_gap') continue;
    const earlier = blockById.get(hit.earlier.blockId);
    if (!earlier) continue;
    if (shiftedBlockIds.has(earlier.id)) continue;
    /**
     * <strong>一趟一整次生成只讓一次。</strong>
     *
     * <code>shiftedBlockIds</code> 只在單次呼叫內有效，而這一支跑在收斂迴圈裡：
     * 挪過去之後站位求解把別的東西推回來，下一輪同一趟又符合條件、又挪一次，
     * 兩邊就這樣互推到迴圈跑滿——使用者實測資料上直接觸發 GEOMETRY_NOT_CONVERGED，
     * 而且迴圈中途收工害 HEADWAY_BELOW_TARGET 從 42 暴增到 141（2026-08-12）。
     *
     * 記在區塊自己身上才跨得了輪。讓步本來就該是<strong>單向、一次性</strong>的：
     * 一趟讓過一次還是不通，代表它不是讓步能解的問題。
     */
    if (earlier.berthArrivalYieldedMinutes != null) continue;
    if (earlier.taskType !== 'passenger' || earlier.source !== 'template_bar') continue;

    // 空等＝自然可以離站之後還被迫留在站上的那一段。沒有空等就沒有餘裕可用，
    // 這一則是單純的兩班排太近，不歸這裡管。
    const idleMinutes = hit.earlier.actualDepartMinute - hit.earlier.endMinute;
    if (idleMinutes <= 1e-9) continue;

    /**
     * <strong>目標是「快發車了才進站」，不是「等對方過去」。</strong>
     *
     * 第一版把目標訂成「挪到路過的那台通過之後」，結果只在一對一、而且對方真的
     * 只是路過時有用；四台車擠在同一格時完全無解——每一台都在等別人，誰讓都不夠。
     *
     * 但看實際數字就會發現有解：T3下行 16:07:10 那四台的<strong>離站時刻是錯開的</strong>
     * （16:08:50、16:10:00、16:11:10、16:14:00），撞在一起的是<strong>到站</strong>——
     * 它們全都提早到，然後一起杵在月台上。只要每一台都改成「快發車了才進站」，
     * 隊伍自己就排好了，不需要任何人特別讓誰。
     *
     * 所以判準改成單純的一句：<strong>把多餘的空等吃掉</strong>。留一個碰撞保護
     * 當折返緩衝，其餘往後挪。不必再問對方是誰、佔多久——每台各自縮短滯留，
     * 全站的重疊自然就散開。
     */
    /*
      緩衝要留<strong>兩倍</strong>碰撞保護，不是一倍。
      規則本來就是「後車到站 ≥ 前車實際離站 + 2 × 碰撞保護」——只留一倍，
      挪完剛好卡在規則邊緣，實測直接製造出 10 秒的真碰撞
      （NTB0911 09:11:00–09:14:30 對上 TS0914 09:14:20，2026-08-12 使用者回報）。
    */
    const marginMinutes = protectionMinutes * 2;
    const neededMinutes = idleMinutes - marginMinutes;
    if (neededMinutes <= 1e-9) continue;

    // 往後挪不會壓到前一段（間隔只會變大），但不能壓到自己排定的下一段
    const rowBlocks = blocksByRow.get(earlier.timelineRow) ?? [];
    const index = rowBlocks.findIndex((item) => item.id === earlier.id);
    const next = index >= 0 ? rowBlocks[index + 1] : undefined;
    /**
     * <strong>整備後的第一班不准挪。</strong>
     *
     * 車做完整備就停在該設施的出場站，這一趟的起點站是<strong>物理事實</strong>，
     * 而且它的發車時刻要跟出廠卡貼齊。整段往後挪會讓出場站對不上，直接觸發
     * <code>YARD_EXIT_STATION_MISMATCH</code>（2026-08-12 使用者回報：充電做完停在
     * N2W下行出發，TNB1500 卻要從 T3上行 發車）。
     */
    const previous = index > 0 ? rowBlocks[index - 1] : undefined;
    if (previous && previous.source === 'template_bar' && previous.taskType !== 'passenger') {
      continue;
    }
    if (
      next
      && earlier.plannedEndMinute + neededMinutes > next.plannedStartMinute - 1e-9
    ) {
      continue;
    }

    earlier.plannedStartMinute += neededMinutes;
    earlier.plannedEndMinute += neededMinutes;
    earlier.berthArrivalYieldedMinutes = neededMinutes;
    shiftedBlockIds.add(earlier.id);
    shifted += 1;

    perStation.set(hit.stationId, {
      stationName: hit.stationName,
      count: (perStation.get(hit.stationId)?.count ?? 0) + 1,
      totalShift: (perStation.get(hit.stationId)?.totalShift ?? 0) + neededMinutes,
    });
  }

  for (const [stationId, item] of perStation) {
    warnings?.push({
      code: 'STATION_BERTH_ARRIVAL_YIELDED',
      severity: 'warning',
      kind: 'policy',
      message:
        `「${item.stationName}」有 ${item.count} 班車跑完一趟後要在站上空等下一趟，`
        + `擋住只是路過的別列車。已讓這幾班晚一點進站（合計往後挪 `
        + `${item.totalShift.toFixed(1)} 分鐘）——它們反正要空等，`
        + `下一趟發車時刻與班距都不變。`,
      detail: { stationId, stationName: item.stationName, shiftedTripCount: item.count, totalShiftMinutes: item.totalShift },
    });
  }

  if (shifted > 0) {
    for (const timeline of timelines) {
      timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    }
  }
  return { shifted };
}
