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

/**
 * 一趟最多往後挪多久。
 *
 * 不設上限的話，理論上可以把一趟推到幾小時後——雖然「下一趟發車不動」在數字上
 * 成立，但車在路上跑的時段整個換掉了，等於偷偷改了班表。挪動量本來就該遠小於
 * 空等時間，取空等的一半當上限：確定是在用<strong>多餘的</strong>餘裕，不是把
 * 空等吃乾抹淨。
 */
const MAX_SHIFT_RATIO = 0.5;

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
    if (earlier.taskType !== 'passenger' || earlier.source !== 'template_bar') continue;

    // 空等＝自然可以離站之後還被迫留在站上的那一段。沒有空等就沒有餘裕可用，
    // 這一則是單純的兩班排太近，不歸這裡管。
    const idleMinutes = hit.earlier.actualDepartMinute - hit.earlier.endMinute;
    if (idleMinutes <= 1e-9) continue;

    /**
     * <strong>只讓給真正「路過」的車。</strong>
     *
     * 第一版對所有 protection_gap 都挪，結果 N2W 從 11 對降到 8 對、
     * T3 卻從 29 對<strong>升到 32 對</strong>——因為對方也在滯留時，把這台挪過去
     * 只是把碰撞推給下一個時刻，兩台都在搶同一格，誰讓都沒有用。
     *
     * 有效的只有「一台杵著、一台路過」這種<strong>不對稱</strong>的情形：
     * 路過的車佔用只有幾秒，讓一下就過去了。對方也長時間佔著就是產能問題，
     * 不是讓步能解的（見 STATION_BERTH_PROTECTION_GAP 的說明）。
     */
    const laterOccupiesMinutes = hit.later.actualDepartMinute - hit.later.startMinute;
    if (laterOccupiesMinutes > 1) continue;

    // 要挪到路過的那台通過、而且連碰撞保護都清乾淨之後才進站
    const neededMinutes =
      hit.later.actualDepartMinute + protectionMinutes - hit.earlier.startMinute;
    if (neededMinutes <= 1e-9) continue;
    if (neededMinutes > idleMinutes * MAX_SHIFT_RATIO + 1e-9) continue;

    // 往後挪不會壓到前一段（間隔只會變大），但不能壓到自己排定的下一段
    const rowBlocks = blocksByRow.get(earlier.timelineRow) ?? [];
    const index = rowBlocks.findIndex((item) => item.id === earlier.id);
    const next = index >= 0 ? rowBlocks[index + 1] : undefined;
    if (
      next
      && earlier.plannedEndMinute + neededMinutes > next.plannedStartMinute - 1e-9
    ) {
      continue;
    }

    earlier.plannedStartMinute += neededMinutes;
    earlier.plannedEndMinute += neededMinutes;
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
