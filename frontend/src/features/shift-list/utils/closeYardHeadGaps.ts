import type {
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';
import { collectFacilityOccupancies } from './stationBerthOccupancy';
import { daySegmentOverlapSeconds } from './moveCardShared';

/**
 * 整備前面不留空白：車到了就開始，整備自己往前長
 * ==============================================
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

export function closeYardHeadGaps(args: {
  timelines: GeneratedScheduleTimeline[];
}): { timelines: GeneratedScheduleTimeline[]; closed: number; secondsRecovered: number } {
  const { timelines } = args;

  // 整備／停留類卡片的實際離開時刻——沒補「暫停」卡也分析得出來，跟最後驗證
  // （validateFacilityOccupancy）同一個答案，見 collectFacilityOccupancies 的說明。
  const actualDepartByBlockId = new Map(
    collectFacilityOccupancies(timelines).map((occ) => [occ.blockId, occ.actualDepartMinute]),
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
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const yard = sorted[index]!;
      if (!isYardBlock(yard)) continue;
      const nodeId = facilityOf(yard);
      if (!nodeId) continue;

      /**
       * 找前一張<strong>有長度</strong>的卡。整備間轉場的出廠／入廠卡在同一區域內
       * 是零長度的（M2 → H1 不用跑），夾在中間會讓「前一張」看起來是那張零長度卡，
       * 空白就永遠關不掉。
       */
      let previousIndex = index - 1;
      const zeroLength: GeneratedScheduleBlock[] = [];
      while (
        previousIndex >= 0
        && sorted[previousIndex]!.plannedEndMinute - sorted[previousIndex]!.plannedStartMinute
          <= 1e-9
      ) {
        zeroLength.push(sorted[previousIndex]!);
        previousIndex -= 1;
      }
      if (previousIndex < 0) continue;
      const previous = sorted[previousIndex]!;
      const gapMinutes = yard.plannedStartMinute - previous.plannedEndMinute;
      if (gapMinutes <= 1 / 60) continue;
      /**
       * 車必須已經在廠裡，否則那段空白是還在路上或還在站上，拉過去等於瞬間移動。
       * 兩種算數：前一張把車送到了這一格，或前一張本身就是同一列的另一段整備
       * （中間只隔著零長度的轉場卡，車根本沒離開廠區）。
       */
      const parkedHere = vehicleEndsAtFacility(previous) === nodeId;
      const stillInYard = isYardBlock(previous) && facilityOf(previous) != null;
      if (!parkedHere && !stillInYard) continue;

      const newStart = previous.plannedEndMinute;
      const taken = bookings.some(
        (booking) =>
          booking.nodeId === nodeId
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
      // 零長度的轉場卡跟著整備的頭一起往前移，維持「出廠→入廠→整備」的相鄰關係
      for (const card of zeroLength) {
        card.plannedStartMinute = newStart;
        card.plannedEndMinute = newStart;
        if (card.anchorStartMinute != null) card.anchorStartMinute = newStart;
        const cardBooking = bookings.find((item) => item.blockId === card.id);
        if (cardBooking) { cardBooking.start = newStart; cardBooking.end = newStart; }
      }
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
