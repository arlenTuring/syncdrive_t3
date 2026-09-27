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
  type StationBerthOccupancy,
} from './stationBerthOccupancy';
import { snapUpToClockAlignSeconds } from './schedule-engine/physics';

export function yieldIdleBlockArrival(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  collisionProtectionSeconds: number;
  /** 只在第一輪收集，避免收斂迴圈每一輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
  /**
   * 逐次驗證：每挪一趟就問一次「整張班表有沒有變好」，答否就把那一次還原。
   *
   * 由呼叫端提供，這一支不自己決定什麼叫「好」——判準必須跟收斂迴圈的全域評分
   * 是同一把尺，否則又會回到「各量各的、互相推翻」的老問題。沒給就不驗證
   * （單元測試與舊呼叫端維持原行為）。
   */
  accept?: () => boolean;
}): { shifted: number } {
  const { timelines, selectedRoutes, collisionProtectionSeconds, warnings, accept } = args;
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

  const shiftedBlockIds = new Set<string>();
  /* 每一站彙總成一則。逐筆列出會有上百則，把已經整理好的摘要淹掉。 */
  const perStation = new Map<string, { stationName: string; count: number; totalShift: number }>();
  let shifted = 0;

  /**
   * 這一趟到站之後，還被迫在站上留多久（分鐘）。
   * 沒有空等就沒有餘裕可用——那是單純兩班排太近，不歸這一支管。
   */
  const idleMinutesOf = (occupancy: StationBerthOccupancy): number =>
    Math.max(0, occupancy.actualDepartMinute - occupancy.readyMinute);

  /** 這一趟可以整段往後挪多少分鐘（不壓到同列下一段、不動整備後首班） */
  const shiftRoomOf = (block: GeneratedScheduleBlock): number | null => {
    if (block.taskType !== 'passenger' || block.source !== 'template_bar') return null;
    // 一趟一整次生成只讓一次，記在區塊自己身上才跨得了輪（見下方說明）
    if (block.berthArrivalYieldedMinutes != null) return null;
    const rowBlocks = blocksByRow.get(block.timelineRow) ?? [];
    const index = rowBlocks.findIndex((item) => item.id === block.id);
    if (index < 0) return null;
    /**
     * <strong>整備後的第一班不准挪。</strong>
     *
     * 車做完整備就停在該設施的出場站，這一趟的起點站是<strong>物理事實</strong>，
     * 而且發車時刻要跟出廠卡貼齊。整段往後挪會讓出場站對不上，直接觸發
     * <code>YARD_EXIT_STATION_MISMATCH</code>（2026-08-12 使用者回報：充電做完停在
     * N2W下行出發，TNB1500 卻要從 T3上行 發車）。
     */
    const previous = index > 0 ? rowBlocks[index - 1] : undefined;
    if (previous && previous.source === 'template_bar' && previous.taskType !== 'passenger') {
      return null;
    }
    const next = rowBlocks[index + 1];
    if (!next) return Number.POSITIVE_INFINITY;
    return Math.max(0, next.plannedStartMinute - block.plannedEndMinute);
  };

  const applyShift = (
    block: GeneratedScheduleBlock,
    shiftMinutes: number,
    hit: (typeof collisions)[number],
  ): boolean => {
    if (shiftMinutes <= 1e-9) return false;
    const room = shiftRoomOf(block);
    if (room == null || shiftMinutes > room - 1e-9) return false;
    const keepStart = block.plannedStartMinute;
    const keepEnd = block.plannedEndMinute;
    block.plannedStartMinute += shiftMinutes;
    block.plannedEndMinute += shiftMinutes;
    /**
     * <strong>挪完立刻驗證，沒變好就還原。</strong>
     *
     * 整趟往後挪不只影響到站那一頭——它的<strong>起點站發車也跟著晚</strong>，
     * 可能在那裡撞上別人。2026-08-20 實測：不驗證直接挪，第一輪就從 3 筆硬錯誤
     * 變成 27 筆。這一支能不能出手，要看整張班表，不是只看眼前這一對。
     */
    if (accept && !accept()) {
      block.plannedStartMinute = keepStart;
      block.plannedEndMinute = keepEnd;
      return false;
    }
    block.berthArrivalYieldedMinutes = shiftMinutes;
    shiftedBlockIds.add(block.id);
    shifted += 1;
    perStation.set(hit.stationId, {
      stationName: hit.stationName,
      count: (perStation.get(hit.stationId)?.count ?? 0) + 1,
      totalShift: (perStation.get(hit.stationId)?.totalShift ?? 0) + shiftMinutes,
    });
    return true;
  };

  for (const hit of collisions) {
    if (hit.kind !== 'protection_gap') continue;

    /**
     * <strong>只挪剛好差的那幾秒，而且優先挪「後車」。</strong>
     *
     * 舊版是把<strong>前車</strong>整趟往後挪，一口氣吃掉幾乎全部空等（只留兩倍
     * 碰撞保護）。兩個問題：
     *
     * 一、<strong>吃掉的餘裕是別人要用的。</strong>那台車在站上空等的那幾分鐘，
     * 正是後面兩道站位讓渡（繞去別站等、開進設施格暫停放）拿來解衝突的資源。
     * 這一支先把它用光，讓渡就沒東西可用了——2026-08-20 實測：讓這一支動手，
     * 讓渡只能把保護不足從 33 降到 15；不讓它動手，讓渡能從 34 降到 11 再降到 6。
     * 局部賺一對、全域賠九對，於是它每一輪都被全域評分整道撤回，等於白做。
     *
     * 二、<strong>它只看前車。</strong>但「早到」的常常是後車：後車到站後本來就
     * 要在原地等下一趟，它早到幾秒沒有任何好處，卻剛好卡進前車的保護窗。實測
     * 剩下的最後一對就是這樣——TNB0905 09:08:30 到「[備用]N2W下行出發」，前車
     * 09:08:40 才清乾淨，差 10 秒；而 TNB0905 到站後要等到 09:13:30 才發下一班。
     *
     * 所以改成：<strong>誰有空等就挪誰，而且只挪差額</strong>。後車優先——挪它
     * 直接消掉這一對；前車不行的話才退而求其次縮短它的滯留。
     */
    const shortfallMinutes = snapUpToClockAlignSeconds(
      Math.max(0, hit.protectionShortfallSeconds),
    ) / 60;
    if (shortfallMinutes <= 1e-9) continue;

    // 後車：往後挪差額就滿足保護，前提是它到站後本來就要空等這麼久
    const later = blockById.get(hit.later.blockId);
    if (
      later
      && !shiftedBlockIds.has(later.id)
      && idleMinutesOf(hit.later) >= shortfallMinutes - 1e-9
      && applyShift(later, shortfallMinutes, hit)
    ) {
      continue;
    }

    /**
     * 前車：挪它不會直接消掉這一對（它的實際離站時刻不變，保護窗也就不變），
     * 但會讓它<strong>晚一點才佔住站位</strong>，把前面那段空窗還給別人。同樣
     * 只挪差額，不把空等吃光。
     */
    const earlier = blockById.get(hit.earlier.blockId);
    if (!earlier || shiftedBlockIds.has(earlier.id)) continue;
    if (idleMinutesOf(hit.earlier) < shortfallMinutes - 1e-9) continue;
    applyShift(earlier, shortfallMinutes, hit);
  }

  for (const [stationId, item] of perStation) {
    warnings?.push({
      code: 'STATION_BERTH_ARRIVAL_YIELDED',
      severity: 'warning',
      kind: 'policy',
      message:
        `「${item.stationName}」有 ${item.count} 班車到站後本來就要在站上空等，`
        + `卻早到幾秒卡進別列車的碰撞保護窗。已讓這幾班晚一點進站（合計往後挪 `
        + `${item.totalShift.toFixed(1)} 分鐘，只挪剛好差的那幾秒）——它們反正要空等，`
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
