/**
 * 正線優先讓渡（橫條落地）：
 * 同列正線／進場載客若占用**接下整備開頭**，把整備開始推到正線結束，鎖住原結束並壓縮時長。
 *
 * 禁止：正線在整備進行中切入（偷尾巴）。那種重疊改由
 * `pushPassengerPastPrecedingYard` 把正線往後推，不得壓縮整備。
 *
 * expand 階段已有同列 cursor 讓渡；站位延後等後處理可能再把正線拖進整備，
 * 必須在生成尾端再跑一次，否則會留下 TIMELINE_OVERLAP（例如 ST 結束 03:33:40、充電仍 03:33:30）。
 *
 * 保養（servicing）的讓渡語意不同：正線不得壓縮保養開頭——即使正線與保養同時刻起始，
 * 也應由 `pushPassengerPastPrecedingYard` 把正線推過保養結束，而非讓渡保養開頭。
 * 只有 `entry_service`（進場載客）才能在保養尾端活動（§10 特例）。
 *
 * 讓渡起點以 `anchorStartMinute`（模板原起點）為地板：若先前為幽靈正線把充電推晚，
 * 正線已被 push／撤走後，必須能縮回模板開頭，不可留下空的八分鐘讓渡。
 */

import {
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  snapUpToClockAlignSeconds,
} from './schedule-engine/physics';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
} from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import {
  SCHEDULE_DAY_MINUTES,
  earliestStartPastBlockerOnDayCycle,
} from './scheduleDayCycle';
import { minimumYardWorkSeconds } from './yardWorkMinimum';

export type MaintenanceYieldOptions = {
  /** 整備設定；用來算各類整備讓渡後至少要留下的工作時間（見 yardWorkMinimum.ts） */
  maintenanceBody?: Record<string, unknown> | null;
  /** 刪掉一班正線時告知原因（報表逐班揭露，見 generate.ts 的 PASSENGER_TRIP_REMOVED） */
  onPassengerRemoved?: (blockId: string, reason: PassengerRemovalReason) => void;
};

/**
 * 正線被刪的原因：
 * - crosses-yards：推過整備要跨兩段以上相接整備、延後 45 分以上，錨點與實際差太遠，不排這一班。
 * - past-midnight：推過整備之後落到 24:00 以後，當日放不下。
 * - incomplete-rotation：不成輪的尾巴（trimIncompleteRotationCycles）。
 */
export type PassengerRemovalReason = 'crosses-yards' | 'past-midnight' | 'incomplete-rotation';

/**
 * 讓這一串正線占掉開頭之後，整備還剩不剩得下最低工作時間。
 *
 * 剩不下的讓渡是不合法的候選：整備不能被壓成零、也不能刪卡假裝做完（白皮書 YARD-03）。
 * 這種占用者不讓渡，改由 {@link pushPassengerPastPrecedingYard} 把正線推過整備；推不動就留著
 * 重疊，由整道評分撤回與最終驗證回報，不刪整備。
 */
function yieldWouldEraseWork(
  occupier: GeneratedScheduleBlock,
  maint: GeneratedScheduleBlock,
  options: MaintenanceYieldOptions,
): boolean {
  const minimumMinutes = minimumYardWorkSeconds(maint.taskType, options.maintenanceBody) / 60;
  return occupier.plannedEndMinute > maint.plannedEndMinute - minimumMinutes + 1e-9;
}
import { resolveContiguousYardBusyUntilMinute } from './maintenancePostTaskPolicy';
import { MEANINGFUL_IDLE_GAP_SECONDS } from './stationBerthOccupancy';

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
 * 判斷指定占用者是否允許讓渡（壓縮開頭）指定整備區塊。
 *
 * - 保養（servicing）：僅允許 entry_service 觸發讓渡；普通正線不得壓縮保養開頭，
 *   應交給 pushPassengerPastPrecedingYard 把正線推走。
 * - 其他整備（charging / inspection / standby）：允許正線讓渡開頭。
 */
function canOccupierYieldMaint(
  occupier: GeneratedScheduleBlock,
  maint: GeneratedScheduleBlock,
): boolean {
  if (maint.taskType === 'servicing') {
    // 保養只允許進場載客（entry_service）讓渡開頭
    return occupier.source === 'entry_service';
  }
  return true;
}

/**
 * 這個正線區塊所屬「連續在外運行」那一串的起點分鐘。
 *
 * 從它往前走，只要中間沒有夾著<strong>別的</strong>整備、而且前後銜接得上
 * （空檔不超過 {@link MEANINGFUL_IDLE_GAP_SECONDS}），就算同一串連續運行——
 * 車一路在路上，從來沒有進去過整備。
 *
 * <code>excludeMaintId</code> 是正在評估的那一段整備：讓渡的重點就是
 * 「它的開始時刻會往後移」，所以它自己不能拿來切斷這串運行，
 * 否則「跑到超過原定整備開始」的那幾腿永遠判不出來跟前面是同一串。
 *
 * 中間停下來等（空檔超過門檻）就不算同一串——那代表車當時是閒著的，
 * 沒有「來不及回來」這回事，不該拿讓渡餘裕去壓縮整備。
 */
function resolveContinuousRunStartMinute(
  ordered: GeneratedScheduleBlock[],
  occupier: GeneratedScheduleBlock,
  excludeMaintId: string,
): number {
  const index = ordered.findIndex((block) => block.id === occupier.id);
  if (index < 0) return occupier.plannedStartMinute;
  let runStart = occupier.plannedStartMinute;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = ordered[i]!;
    if (prev.id === excludeMaintId) continue;
    // 車真的進去過別的整備：這串運行到此為止
    if (isYieldableMaintenanceBlock(prev)) break;
    if (!isYieldOccupyingBlock(prev)) continue;
    const gapSeconds = (runStart - prev.plannedEndMinute) * 60;
    if (gapSeconds > MEANINGFUL_IDLE_GAP_SECONDS) break;
    runStart = Math.min(runStart, prev.plannedStartMinute);
  }
  return runStart;
}

/** 正線（非進場載客）不可壓任何整備尾巴；進場載客僅允許偷保養尾巴。 */
function mustNotStealYardTail(
  occupier: GeneratedScheduleBlock,
  yard: GeneratedScheduleBlock,
): boolean {
  if (occupier.source === 'entry_service' && yard.taskType === 'servicing') {
    return false;
  }
  return true;
}

/**
 * 對每條時間線套用正線優先讓渡：僅當正線自整備開始前（含起點）切入時，
 * 整備開始不得早於該正線的結束（吃開頭、鎖尾）。
 */
export function applyMainlineMaintenanceEntryYield(
  timelines: GeneratedSchedulePlan['timelines'],
  options: MaintenanceYieldOptions = {},
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
      // 模板原起點（anchor）；讓渡可往後推，也可在幽靈正線消失後縮回。
      const floorStartMinute = Math.min(
        maint.plannedStartMinute,
        maint.anchorStartMinute,
      );
      let nextStartMinute = floorStartMinute;

      for (const other of ordered) {
        if (other.id === maint.id) continue;
        if (!isYieldOccupyingBlock(other)) continue;
        // 保養（servicing）不允許普通正線讓渡開頭；由 pushPassengerPastPrecedingYard 處理
        if (!canOccupierYieldMaint(other, maint)) continue;
        // 只吃開頭：這一串連續運行必須在「模板整備起點」之前就已發車。
        // 判斷用的是<strong>整串</strong>的起點，不是這一腿自己的起點——
        // 一輪跑到超過整備開始時刻，後面幾腿的起點本來就會晚於整備，
        // 但車從頭到尾都在路上、根本還沒進去整備，那正是讓渡要處理的情況。
        // 與整備同時起點（例保養尾接行檢 09:30）＝不得讓渡壓縮整備，改由 push 推過整串。
        const runStartMinute = resolveContinuousRunStartMinute(ordered, other, maint.id);
        if (runStartMinute >= floorStartMinute - 1e-9) continue;
        if (yieldWouldEraseWork(other, maint, options)) continue;
        if (
          other.plannedStartMinute < lockedEndMinute - 1e-9
          && other.plannedEndMinute > floorStartMinute + 1e-9
        ) {
          nextStartMinute = Math.max(nextStartMinute, other.plannedEndMinute);
        }
      }

      if (Math.abs(nextStartMinute - maint.plannedStartMinute) > 1e-9) {
        // 只收剩得下最低工作時間的占用者（見 yieldWouldEraseWork），開始一定早於結束；結束鎖住不動
        maint.plannedStartMinute = nextStartMinute;
        maint.plannedEndMinute = lockedEndMinute;
      }
    }

    // 整備一張都不刪：壓不下的占用者交給 pushPassengerPastPrecedingYard
    return {
      ...timeline,
      blocks: blocks
        .sort(
          (a, b) =>
            a.plannedStartMinute - b.plannedStartMinute
            || a.id.localeCompare(b.id),
        ),
    };
  });
}

/**
 * 正線／進場載客不得壓在同一列整備／行檢／充電／待命上（含跨夜保養拆成晚段＋晨段）。
 * 線性分鐘看不見「午夜後正線 vs 清晨保養」時，以日循環 ±1 日拷貝判定；
 * 若已重疊，整趟平移到整備結束（時長不變）。推到 ≥24:00 表示當日放不下 → 刪除該正線。
 */
export function pushPassengerPastPrecedingYard(
  timelines: GeneratedSchedulePlan['timelines'],
  options: MaintenanceYieldOptions = {},
): GeneratedSchedulePlan['timelines'] {
  return timelines.map((timeline) => {
    const blocks = timeline.blocks.map((block) => ({ ...block }));
    const ordered = [...blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || a.id.localeCompare(b.id),
    );
    const dropIds = new Set<string>();

    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i]!;
      if (dropIds.has(current.id)) continue;
      if (!isYieldOccupyingBlock(current)) continue;

      let earliestStartSecond = minuteToSecond(current.plannedStartMinute);
      // 同列所有整備都要查（晨段 start=0 排在前，但午夜後正線需對晨段做 +1440 拷貝）
      for (const prev of ordered) {
        if (prev.id === current.id) continue;
        if (dropIds.has(prev.id)) continue;
        if (!isYieldableMaintenanceBlock(prev)) continue;
        if (!mustNotStealYardTail(current, prev)) continue;

        // 讓渡進行中的整串正線不推：這串從整備原定開始之前就出發了，車一路在路上，
        // 根本還沒進去整備。該往後移的是整備開始時刻（applyMainlineMaintenanceEntryYield
        // 已在同一輪先做過），不是把正線推走——推走會讓班次落到整備結束之後、
        // 超出正線視窗而被撤掉，等於讓渡餘裕白設。
        if (canOccupierYieldMaint(current, prev) && !yieldWouldEraseWork(current, prev, options)) {
          const yardFloorMinute = Math.min(
            prev.plannedStartMinute,
            prev.anchorStartMinute,
          );
          const runStartMinute = resolveContinuousRunStartMinute(
            ordered,
            current,
            prev.id,
          );
          if (runStartMinute < yardFloorMinute - 1e-9) continue;
        }

        const clearMinute = earliestStartPastBlockerOnDayCycle(
          current.plannedStartMinute,
          current.plannedEndMinute,
          prev.plannedStartMinute,
          prev.plannedEndMinute,
        );
        if (clearMinute == null) continue;
        // 推到整備串尾（保養→行檢相接時，不可停在 09:30 銜接點）
        const yardTasks = ordered
          .filter((block) => isYieldableMaintenanceBlock(block))
          .map((block) => ({
            rowIndex: timeline.row,
            taskType: block.taskType,
            startMinute: block.plannedStartMinute,
            durationMinutes: Math.max(
              0,
              block.plannedEndMinute - block.plannedStartMinute,
            ),
          }));
        const chainEnd = resolveContiguousYardBusyUntilMinute(
          yardTasks,
          timeline.row,
          Math.min(clearMinute, prev.plannedEndMinute) - 1e-6,
        );
        const targetMinute =
          chainEnd != null ? Math.max(clearMinute, chainEnd) : clearMinute;
        // 若一推會跨越多段相接整備（充電→保養→行檢），刪掉幽靈班，
        // 不要錨點留在充電前、實際跑到整備後。單段整備（僅偷尾巴／撞保養）仍推過即可。
        const pushDeltaMinutes = targetMinute - current.plannedStartMinute;
        const yardsCrossed = ordered.filter((yard) => {
          if (!isYieldableMaintenanceBlock(yard)) return false;
          if (dropIds.has(yard.id)) return false;
          return (
            yard.plannedStartMinute < targetMinute - 1e-9
            && yard.plannedEndMinute > current.plannedStartMinute + 1e-9
          );
        }).length;
        if (pushDeltaMinutes >= 45 && yardsCrossed >= 2) {
          dropIds.add(current.id);
          options.onPassengerRemoved?.(current.id, 'crosses-yards');
          break;
        }
        earliestStartSecond = Math.max(
          earliestStartSecond,
          snapUpToClockAlignSeconds(minuteToSecond(targetMinute)),
        );
      }

      const curStart = minuteToSecond(current.plannedStartMinute);
      if (dropIds.has(current.id)) continue;
      if (earliestStartSecond <= curStart + 1e-9) continue;

      const occupancySeconds = Math.max(
        SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
        minuteToSecond(current.plannedEndMinute) - curStart,
      );
      current.plannedStartMinute = secondToMinute(earliestStartSecond);
      current.plannedEndMinute = secondToMinute(
        earliestStartSecond + occupancySeconds,
      );

      // 跨夜保養窗仍佔住隔日清晨：正線被推到 ≥24:00 → 當日循環放不下，刪除
      if (current.plannedStartMinute >= SCHEDULE_DAY_MINUTES - 1e-9) {
        dropIds.add(current.id);
        options.onPassengerRemoved?.(current.id, 'past-midnight');
        continue;
      }

      // 連鎖：同列後面的正線若被壓住，一併往後挪（保持相對不重疊）
      let prevOccupier = current;
      for (let k = i + 1; k < ordered.length; k += 1) {
        const next = ordered[k]!;
        if (dropIds.has(next.id)) continue;
        if (!isYieldOccupyingBlock(next)) continue;
        if (next.plannedStartMinute + 1e-9 >= prevOccupier.plannedEndMinute) {
          break;
        }
        const nextOcc = Math.max(
          SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
          minuteToSecond(next.plannedEndMinute)
            - minuteToSecond(next.plannedStartMinute),
        );
        const nextStart = snapUpToClockAlignSeconds(
          minuteToSecond(prevOccupier.plannedEndMinute),
        );
        next.plannedStartMinute = secondToMinute(nextStart);
        next.plannedEndMinute = secondToMinute(nextStart + nextOcc);
        if (next.plannedStartMinute >= SCHEDULE_DAY_MINUTES - 1e-9) {
          dropIds.add(next.id);
          options.onPassengerRemoved?.(next.id, 'past-midnight');
          break;
        }
        prevOccupier = next;
      }
    }

    return {
      ...timeline,
      blocks: blocks
        .filter((block) => !dropIds.has(block.id))
        .sort(
          (a, b) =>
            a.plannedStartMinute - b.plannedStartMinute
            || a.id.localeCompare(b.id),
        ),
    };
  });
}
