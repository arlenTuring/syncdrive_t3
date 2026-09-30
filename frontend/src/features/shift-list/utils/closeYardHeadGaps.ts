import type {
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';
import { collectFacilityOccupancies } from './stationBerthOccupancy';
import { daySegmentOverlapSeconds } from './moveCardShared';
import { isWorkYardTaskType } from './yardWorkMinimum';

/**
 * 待命前面不留空白：車到了就開始待命
 * ==================================
 *
 * <strong>2026-09-29 起只適用待命。</strong>充電、保養、行檢、洗車是作業：提早到只能等待，
 * 不能提早開工（白皮書 YARD-07）。作業類整備前面的空檔維持原訂開始時刻，格位佔用從抵達就算
 * （collectFacilityOccupancies），畫面由 fillYardHoldGaps 補一張「等待」卡。待命本身就是等待，
 * 照舊往前接起來。以下是這支原本的說明。
 *
 *
 * <strong>問題長相。</strong>車跑完最後一趟開進整備格，卻要在格子裡乾等到整備區塊
 * 的原訂開始時刻——班表上就是「入廠卡一張，後面一大段空白，再接充電卡」。使用者
 * （2026-08-18）：「你就是入廠卡一張，然後後面就是尾巴直接接著充電卡，就是直接安排
 * 充電了……待命卡有類似的情況也是直接延伸接起來，這樣充電卡顯示的充電整備班次的
 * 時間才是合理的……你決定要進去了，就是一張入場，後面就是接整備，不要猶豫」。
 *
 * <strong>做法。</strong>整備區塊的<strong>開始時刻往前拉</strong>到前一張卡結束的
 * 當下，結束時刻不動——與 insertMaintenanceTransferCards 的「車一到就開始整備」
 * 完全同一條規則，這裡只是把各條路徑漏掉的那幾處補齊。
 *
 * <strong>只在車確實已經在那一格時才拉。</strong>前一張卡必須是開往這一格的移動卡
 * （<code>yardExitFacilityNodeId</code> 指向同一格），或是同一格的另一段整備；否則
 * 那段空白是車還在路上或還在站上，拉過去等於讓車瞬間移動。
 *
 * <strong>不搶別人的格子。</strong>要往前拉的那段時間，該設施格必須沒有別列車預約——
 * 提早開工不能是特權（見 insertMaintenanceTransferCards 對 EG1926 排擠案例的說明）。
 *
 * <strong>「別列車有沒有預約」看的是實際佔用，不是卡片自己的起訖。</strong>整備／
 * 停留類卡片就算排定的區塊結束了，車沒真的開走之前格位仍算佔著（見
 * {@link collectFacilityOccupancies} 的說明）——這裡要拉的候選空位檢查如果只看
 * 卡片自己的 <code>plannedEndMinute</code>，會把「已經佔著、只是排定的整備區塊寫的
 * 結束時刻比較早」的格子誤判成空的。比對也用跨午夜安全的日循環重疊（見
 * {@link daySegmentOverlapSeconds}），不直接比較 start／end 的分鐘數字。
 */

function isYardBlock(block: GeneratedScheduleBlock): boolean {
  return (
    block.taskType !== 'passenger'
    && block.taskType !== 'dispatch'
    && block.taskType !== 'idle'
  );
}

function facilityOf(block: GeneratedScheduleBlock): string | null {
  return block.yardFacilityNodeId?.trim() || null;
}

/** 前一張卡把車送到了哪一格（移動卡看目的地，整備看它自己停的格） */
function vehicleEndsAtFacility(block: GeneratedScheduleBlock): string | null {
  if (block.taskType === 'dispatch') {
    return block.yardExitFacilityNodeId?.trim() || null;
  }
  return facilityOf(block);
}

/** 同一刻結束的卡誰在後：整備做完 → 出廠 → 入廠（入廠才把車送到下一格） */
function sameInstantOrder(block: GeneratedScheduleBlock): number {
  if (block.taskType !== 'dispatch') return 0;
  return block.source === 'yard_exit_move' ? 1 : 2;
}

export function closeYardHeadGaps(args: {
  timelines: GeneratedScheduleTimeline[];
}): { timelines: GeneratedScheduleTimeline[]; closed: number; secondsRecovered: number } {
  const { timelines } = args;

  // 整備／停留類卡片的實際離開時刻——沒補「暫停」卡也分析得出來，跟最後驗證
  // （validateFacilityOccupancy）同一個答案，見 collectFacilityOccupancies 的說明。
  const actualDepartByBlockId = new Map(
    collectFacilityOccupancies(timelines).flatMap((occ) =>
      occ.blockIds.map((blockId) => [blockId, occ.actualDepartMinute] as const)),
  );

  // 各設施格目前被哪些區間佔著；key 帶上卡片 id，往前拉時要排除自己。
  // 整備／停留類卡片用實際離開時刻，不是卡片自己寫的結束時刻。
  const bookings: { nodeId: string; start: number; end: number; blockId: string; row: number }[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      const nodeId = facilityOf(block) ?? block.yardExitFacilityNodeId?.trim() ?? null;
      if (!nodeId) continue;
      bookings.push({
        nodeId,
        start: block.plannedStartMinute,
        end: actualDepartByBlockId.get(block.id) ?? block.plannedEndMinute,
        blockId: block.id,
        row: timeline.row,
      });
    }
  }

  let closed = 0;
  let secondsRecovered = 0;

  for (const timeline of timelines) {
    for (const yard of timeline.blocks) {
      if (!isYardBlock(yard)) continue;
      if (isWorkYardTaskType(yard.taskType)) continue;
      const nodeId = facilityOf(yard);
      if (!nodeId) continue;

      /**
       * 前一張＝在待命開始前、<strong>最晚結束</strong>的那張卡，也就是車開進待命前最後在做的事。
       *
       * 不能照開始時刻排序取鄰居：整備間轉場為了閃轉折點會把零長度的出廠／入廠卡往後挪，
       * 挪到跟待命同一刻開始（例：充電 16:00 結束、E2 → E4 轉場挪到 16:01、待命也是 16:01）。
       * 同一刻開始的卡排序不穩定，待命排在轉場卡前面時，「前一張」會變成充電，待命就被拉回
       * 16:00——車 16:01 才離開 E2，班表卻說它 16:00 已經在 E4 待命（2026-09-30 重播實錄，
       * VEHICLE_LOCATION_DISCONTINUITY）。
       *
       * 同一刻開始的零長度移動卡算在待命之前：它在那一刻就把車送到了。
       */
      const previous = timeline.blocks
        .filter(
          (block) =>
            block !== yard
            && (block.plannedStartMinute < yard.plannedStartMinute - 1e-9
              || (block.taskType === 'dispatch'
                && Math.abs(block.plannedStartMinute - yard.plannedStartMinute) <= 1e-9
                && block.plannedEndMinute - block.plannedStartMinute <= 1e-9)),
        )
        .reduce<GeneratedScheduleBlock | null>(
          (latest, block) =>
            latest == null
            || block.plannedEndMinute > latest.plannedEndMinute + 1e-9
            || (Math.abs(block.plannedEndMinute - latest.plannedEndMinute) <= 1e-9
              && sameInstantOrder(block) > sameInstantOrder(latest))
              ? block
              : latest,
          null,
        );
      if (!previous) continue;
      const gapMinutes = yard.plannedStartMinute - previous.plannedEndMinute;
      if (gapMinutes <= 1 / 60) continue;
      /**
       * 車必須已經在這一格裡：前一張把車送到了這一格（移動卡的目的地），或前一張本身
       * 就停在這一格。停在別格（中間沒有移動卡）就是車還沒過來，拉過去等於瞬間移動
       * ——先前「只要還在廠區就算」的放寬正是那樣；移動卡的時刻由轉場搜尋定案
       * （含閃轉折點的位移），這裡只把待命的頭接到車真正抵達的那一刻，不動移動卡。
       */
      if (vehicleEndsAtFacility(previous) !== nodeId) continue;

      const newStart = previous.plannedEndMinute;
      const taken = bookings.some(
        (booking) =>
          booking.nodeId === nodeId
          && booking.row !== timeline.row
          && booking.blockId !== yard.id
          && booking.blockId !== previous.id
          && daySegmentOverlapSeconds(
            minuteToSecond(newStart),
            minuteToSecond(yard.plannedStartMinute),
            minuteToSecond(booking.start),
            minuteToSecond(booking.end),
          ) > 1e-6,
      );
      if (taken) continue;

      const booking = bookings.find((item) => item.blockId === yard.id);
      if (booking) booking.start = newStart;
      if (yard.anchorStartMinute != null) {
        yard.anchorStartMinute -= yard.plannedStartMinute - newStart;
      }
      secondsRecovered += (yard.plannedStartMinute - newStart) * 60;
      yard.plannedStartMinute = newStart;
      closed += 1;
    }
  }

  return { timelines, closed, secondsRecovered };
}
