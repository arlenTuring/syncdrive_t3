import type {
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';

/**
 * 補上「暫停」卡：整備做完、車還在格子裡的那段
 * ============================================
 *
 * <strong>暫停不是待命。</strong>待命是<strong>指令</strong>——為了下一趟要去的地方，
 * 先開到那裡等；暫停是<strong>沒有指令</strong>——整備卡在卡內把事情做完了，剩下的
 * 空隙車就停在那裡，但時間軸上沒有任何東西記載這件事。
 *
 * <strong>為什麼要補成一張卡，而不是讓偵測器自己推論。</strong>站位那邊是用
 * <code>actualDepartMinute</code> 把佔用延長到車真正開走，所以站位碰撞抓得到「賴站
 * 擋人」。但那是<strong>某一個偵測器內部的推論</strong>——沒有複製那段推論的地方就
 * 有同樣的盲點。設施佔用就是活生生的例子：它只記
 * <code>[整備開始, 整備結束]</code>，於是「整備做完、還沒開走」的那段帳上是空的：
 *
 * <pre>
 *   列4  充電 @ E3   22:12:40 – 00:00:00   ← 登記的佔用只到這裡
 *   列4  整備出廠 E3 → N2W下行出發  00:01:00 – 00:01:30   ← 車 00:01:00 才開走
 *   列7  整備入廠 → E3              00:00:30 – 00:01:00   ← 朝著「帳面上空」的格子開過去
 *   列7  充電 @ E3                  00:01:00 – 01:30:00   ← 零間隔交接
 * </pre>
 *
 * 使用者（2026-08-24）：「當你的機制有辦法補滿所有的時間空隙的時候，就能真正的去
 * 看待任何的碰撞跟移動……這不是一種裝飾，而是你架構上再做最後驗證以及修正所需要
 * 考慮到自己可能會產生演算法缺陷的問題。」
 *
 * <strong>只補設施側，不補站位側。</strong>站位側那 251 段（16 小時）已經由
 * <code>actualDepartMinute</code> 涵蓋，補卡不會讓偵測看到新東西，卻會把「插卡改變
 * 前後相鄰關係」的風險放大八倍——引擎裡很多處理是看前一張／下一張卡做判斷的。
 * 設施側這 33 段（3.6 小時）才是沒有任何人看得到的洞。
 *
 * <strong>掛 <code>idle</code> 而不是 <code>standby</code>。</strong>整備轉場機制以
 * <code>taskType === 'standby'</code> 認定「這是排定的待命，要幫它排進出廠卡」；掛成
 * standby 會被重複服務（2026-08-18 實測：MAINTENANCE_TRANSFER_UNRESOLVED 13 → 22，
 * 且冒出前面根本沒有整備的孤兒出場卡）。
 */

/** 車真的停在裡面的那幾種整備 */
const YARD_TASK_TYPES = new Set([
  'charging',
  'servicing',
  'inspection',
  'standby',
  'washing',
]);

function isZeroLength(block: GeneratedScheduleBlock): boolean {
  return block.plannedEndMinute - block.plannedStartMinute <= 1e-9;
}

export function fillYardHoldGaps(args: {
  timelines: GeneratedScheduleTimeline[];
}): { timelines: GeneratedScheduleTimeline[]; inserted: number; heldSeconds: number } {
  const { timelines } = args;
  let inserted = 0;
  let heldSeconds = 0;

  for (const timeline of timelines) {
    // 零長度卡（同區域 0 秒轉場的示意卡）不佔時間，夾在中間會讓「前一張」認錯人
    const ordered = [...timeline.blocks]
      .filter((block) => !isZeroLength(block))
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);

    const added: GeneratedScheduleBlock[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const next = ordered[index]!;

      // 只補「前一張是整備、而且車停在某個設施格」的空隙
      if (!YARD_TASK_TYPES.has(previous.taskType)) continue;
      const facilityNodeId = previous.yardFacilityNodeId?.trim();
      if (!facilityNodeId) continue;

      const gapMinutes = next.plannedStartMinute - previous.plannedEndMinute;
      if (gapMinutes <= 1 / 60) continue;

      const facilityLabel = previous.yardFacilityLabel ?? facilityNodeId;
      added.push({
        id: `hold-${previous.id}-${Math.round(previous.plannedEndMinute * 60)}`,
        timelineRow: timeline.row,
        taskType: 'idle',
        label: `時間線 ${timeline.row} · 暫停 · ${facilityLabel}`,
        anchorStartMinute: previous.plannedEndMinute,
        plannedStartMinute: previous.plannedEndMinute,
        plannedEndMinute: next.plannedStartMinute,
        travelSeconds: 0,
        dwellSeconds: Math.round(gapMinutes * 60),
        source: 'hold',
        // 車就停在這一格——設施佔用要看得到它
        yardFacilityNodeId: facilityNodeId,
        yardFacilityLabel: facilityLabel,
        yardFacilityStationId: previous.yardFacilityStationId,
      } as GeneratedScheduleBlock);
      inserted += 1;
      heldSeconds += gapMinutes * 60;
    }

    if (added.length > 0) {
      timeline.blocks.push(...added);
      timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    }
  }

  return { timelines, inserted, heldSeconds };
}
